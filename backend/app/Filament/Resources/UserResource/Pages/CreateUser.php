<?php

namespace App\Filament\Resources\UserResource\Pages;

use App\Filament\Resources\UserResource;
use App\Models\User;
use Filament\Resources\Pages\CreateRecord;
use Illuminate\Database\Eloquent\Model;

class CreateUser extends CreateRecord
{
    protected static string $resource = UserResource::class;

    /**
     * SEC-005: see EditUser::handleRecordUpdate() for why this panel's own
     * forms use forceFill() rather than relying on $fillable.
     */
    protected function handleRecordCreation(array $data): Model
    {
        $user = new User;
        $user->forceFill($data);
        $user->save();

        return $user;
    }
}
