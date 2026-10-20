<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Membership;
use App\Models\Organization;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function __construct(private readonly AuditLogger $auditLogger)
    {
    }

    public function register(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
            'organization_name' => ['nullable', 'string', 'max:255'],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
        ]);

        $organization = Organization::create([
            'name' => $data['organization_name'] ?? "{$user->name}'s workspace",
            'slug' => Str::slug($user->name.'-'.Str::random(6)),
        ]);

        Membership::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'role' => 'owner',
        ]);

        event(new Registered($user));

        $token = $user->createToken('api')->plainTextToken;

        $this->auditLogger->logRequest($request, 'user.registered', 'user', (string) $user->id);

        return response()->json([
            'data' => [
                'user' => $user,
                'token' => $token,
                'organization_id' => $organization->id,
            ],
        ], 201);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        $passwordMatches = $user ? Hash::check($data['password'], $user->password) : false;

        if (! $passwordMatches) {
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        if ($user->isSuspended()) {
            throw ValidationException::withMessages([
                'email' => ['This account has been suspended.'],
            ]);
        }

        $token = $user->createToken('api')->plainTextToken;

        $this->auditLogger->logRequest($request, 'user.login', 'user', (string) $user->id);

        return response()->json([
            'data' => [
                'user' => $user,
                'token' => $token,
            ],
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['data' => ['message' => 'Logged out.']]);
    }

    public function forgotPassword(Request $request)
    {
        $request->validate(['email' => ['required', 'email']]);

        // Always return a generic success message regardless of whether the
        // email exists, so this endpoint can't be used to enumerate accounts.
        Password::sendResetLink($request->only('email'));

        return response()->json(['data' => ['message' => 'If that email exists, a reset link has been sent.']]);
    }

    public function resetPassword(Request $request)
    {
        $data = $request->validate([
            'token' => ['required'],
            'email' => ['required', 'email'],
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
        ]);

        $status = Password::reset($data, function (User $user, string $password) {
            $user->forceFill(['password' => Hash::make($password)])->save();
            $user->tokens()->delete();
        });

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['email' => [__($status)]]);
        }

        return response()->json(['data' => ['message' => 'Password reset.']]);
    }

    public function sendVerificationEmail(Request $request)
    {
        if ($request->user()->hasVerifiedEmail()) {
            return response()->json(['data' => ['message' => 'Already verified.']]);
        }

        $request->user()->sendEmailVerificationNotification();

        return response()->json(['data' => ['message' => 'Verification email sent.']]);
    }

    public function verifyEmail(Request $request, int $id, string $hash)
    {
        $user = User::findOrFail($id);

        $validHash = hash_equals($hash, sha1($user->getEmailForVerification()));

        if (! $validHash) {
            abort(403, 'Invalid verification link.');
        }

        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
        }

        return response()->json(['data' => ['message' => 'Email verified.']]);
    }

    public function me(Request $request)
    {
        $user = $request->user()->load('memberships.organization');

        return response()->json(['data' => $user]);
    }

    public function updateProfile(Request $request)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'password' => ['sometimes', 'confirmed', Rules\Password::defaults()],
        ]);

        $user = $request->user();

        if (isset($data['name'])) {
            $user->name = $data['name'];
        }

        if (isset($data['password'])) {
            $user->password = Hash::make($data['password']);
            $currentTokenId = $user->currentAccessToken()->id;
            $user->tokens()->whereKeyNot($currentTokenId)->delete();
        }

        $user->save();

        return response()->json(['data' => $user]);
    }

    /**
     * Account deletion (docs/01 section 1.6 privacy requirement). Blocked
     * if the user is the sole owner of an organization that still has other
     * members - ownership must be transferred first. Otherwise, any
     * organization where this is the last membership is deleted entirely
     * (cascades to its projects/documents/etc.), then the user is removed.
     */
    public function destroy(Request $request)
    {
        $data = $request->validate(['password' => ['required', 'string']]);

        $user = $request->user();

        $passwordMatches = Hash::check($data['password'], $user->password);

        if (! $passwordMatches) {
            throw ValidationException::withMessages(['password' => ['Incorrect password.']]);
        }

        foreach ($user->memberships as $membership) {
            $organization = $membership->organization;
            $otherMembers = $organization->memberships()
                ->whereKeyNot($membership->id)
                ->exists();

            if ($membership->isOwner() && $otherMembers) {
                return response()->json([
                    'message' => "Transfer ownership of \"{$organization->name}\" before deleting your account.",
                    'errors' => (object) [],
                ], 409);
            }

            if (! $otherMembers) {
                $organization->delete();
            }
        }

        $this->auditLogger->logRequest($request, 'user.deleted', 'user', (string) $user->id);

        $user->tokens()->delete();
        $user->delete();

        return response()->json(['data' => ['message' => 'Account deleted.']]);
    }
}
