<?php

namespace App\Filament\Resources;

use App\Filament\Resources\AuditLogResource\Pages;
use App\Models\AuditLog;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;

/**
 * Security/admin audit trail (docs/06 section 6.2). Deliberately read-only -
 * no create/edit/delete actions - because an editable audit log isn't one.
 */
class AuditLogResource extends Resource
{
    protected static ?string $model = AuditLog::class;

    protected static ?string $navigationIcon = 'heroicon-o-shield-exclamation';

    protected static ?string $navigationGroup = 'Security';

    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit($record): bool
    {
        return false;
    }

    public static function canDelete($record): bool
    {
        return false;
    }

    public static function form(Form $form): Form
    {
        return $form->schema([]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('created_at')->dateTime()->sortable(),
                Tables\Columns\TextColumn::make('actor.name')->label('Actor')->default('System'),
                Tables\Columns\TextColumn::make('action')->searchable()->badge(),
                Tables\Columns\TextColumn::make('target_type')->label('Target'),
                Tables\Columns\TextColumn::make('target_id')->label('Target ID')->limit(20),
                Tables\Columns\TextColumn::make('ip_address'),
                Tables\Columns\TextColumn::make('metadata')
                    ->formatStateUsing(fn ($state) => $state ? json_encode($state) : '')
                    ->limit(60)
                    ->wrap(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                Tables\Filters\SelectFilter::make('action')
                    ->options(fn () => AuditLog::query()->distinct()->pluck('action', 'action')->toArray()),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListAuditLogs::route('/'),
        ];
    }
}
