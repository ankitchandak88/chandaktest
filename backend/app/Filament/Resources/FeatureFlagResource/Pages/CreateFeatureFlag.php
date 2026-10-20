<?php

namespace App\Filament\Resources\FeatureFlagResource\Pages;

use App\Filament\Resources\FeatureFlagResource;
use Filament\Actions;
use Filament\Resources\Pages\CreateRecord;

class CreateFeatureFlag extends CreateRecord
{
    protected static string $resource = FeatureFlagResource::class;
}
