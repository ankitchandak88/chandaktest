<?php

namespace App\Filament\Resources\FeatureFlagResource\Pages;

use App\Filament\Resources\FeatureFlagResource;
use Filament\Actions;
use Filament\Resources\Pages\EditRecord;

class EditFeatureFlag extends EditRecord
{
    protected static string $resource = FeatureFlagResource::class;

    protected function getHeaderActions(): array
    {
        return [
            Actions\DeleteAction::make(),
        ];
    }
}
