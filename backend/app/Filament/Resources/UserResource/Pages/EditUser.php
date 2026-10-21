<?php

namespace App\Filament\Resources\UserResource\Pages;

use App\Filament\Resources\UserResource;
use App\Models\User;
use Filament\Actions;
use Filament\Resources\Pages\EditRecord;
use Illuminate\Database\Eloquent\Model;

class EditUser extends EditRecord
{
    protected static string $resource = UserResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Actions\DeleteAction::make(),
        ];
    }

    /**
     * SEC-005: is_super_admin/status/suspended_* are intentionally outside
     * User::$fillable (see that model). This whole panel is already gated
     * to super-admins/support staff via User::canAccessPanel(), so a
     * forceFill() here - for THIS authorized admin form only - is the
     * correct way to let it still save those fields, instead of loosening
     * mass-assignment protection globally.
     */
    protected function handleRecordUpdate(Model $record, array $data): Model
    {
        /** @var User $record */
        $record->forceFill($data)->save();

        return $record;
    }
}
