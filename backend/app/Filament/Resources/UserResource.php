<?php

namespace App\Filament\Resources;

use App\Filament\Resources\UserResource\Pages;
use App\Models\User;
use App\Services\AuditLogger;
use Filament\Forms;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Support\Facades\Hash;

class UserResource extends Resource
{
    protected static ?string $model = User::class;

    protected static ?string $navigationIcon = 'heroicon-o-users';

    protected static ?string $navigationGroup = 'Accounts';

    public static function form(Form $form): Form
    {
        return $form
            ->schema([
                Forms\Components\TextInput::make('name')
                    ->required()
                    ->maxLength(255),
                Forms\Components\TextInput::make('email')
                    ->email()
                    ->required()
                    ->maxLength(255)
                    ->unique(ignoreRecord: true),
                Forms\Components\DateTimePicker::make('email_verified_at'),
                Forms\Components\TextInput::make('password')
                    ->password()
                    ->dehydrateStateUsing(fn ($state) => Hash::make($state))
                    ->dehydrated(fn ($state) => filled($state))
                    ->required(fn (string $context) => $context === 'create')
                    ->helperText('Leave blank to keep the current password.'),
                Forms\Components\Toggle::make('is_super_admin')
                    ->label('Super admin (Filament access)')
                    ->helperText('Grants access to this admin panel.'),
                Forms\Components\Select::make('status')
                    ->options(['active' => 'Active', 'suspended' => 'Suspended'])
                    ->required(),
                Forms\Components\TextInput::make('suspended_reason')
                    ->maxLength(255)
                    ->visible(fn (Forms\Get $get) => $get('status') === 'suspended'),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('name')->searchable(),
                Tables\Columns\TextColumn::make('email')->searchable(),
                Tables\Columns\IconColumn::make('email_verified_at')->label('Verified')->boolean(),
                Tables\Columns\TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state) => $state === 'active' ? 'success' : 'danger'),
                Tables\Columns\IconColumn::make('is_super_admin')->label('Admin')->boolean(),
                Tables\Columns\TextColumn::make('created_at')->dateTime()->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                Tables\Filters\SelectFilter::make('status')
                    ->options(['active' => 'Active', 'suspended' => 'Suspended']),
            ])
            ->actions([
                Tables\Actions\EditAction::make(),
                Tables\Actions\Action::make('suspend')
                    ->visible(fn (User $record) => $record->status === 'active')
                    ->requiresConfirmation()
                    ->icon('heroicon-o-no-symbol')
                    ->color('danger')
                    ->form([
                        Forms\Components\Textarea::make('reason')->required(),
                    ])
                    ->action(function (User $record, array $data) {
                        $record->update([
                            'status' => 'suspended',
                            'suspended_reason' => $data['reason'],
                            'suspended_at' => now(),
                        ]);
                        $record->tokens()->delete();

                        app(AuditLogger::class)->log(
                            auth()->id(),
                            'admin.user_suspended',
                            'user',
                            (string) $record->id,
                            ['reason' => $data['reason']]
                        );

                        Notification::make()->title('User suspended')->success()->send();
                    }),
                Tables\Actions\Action::make('restore_access')
                    ->label('Restore')
                    ->visible(fn (User $record) => $record->status === 'suspended')
                    ->requiresConfirmation()
                    ->icon('heroicon-o-check-circle')
                    ->color('success')
                    ->action(function (User $record) {
                        $record->update([
                            'status' => 'active',
                            'suspended_reason' => null,
                            'suspended_at' => null,
                        ]);

                        app(AuditLogger::class)->log(
                            auth()->id(),
                            'admin.user_restored',
                            'user',
                            (string) $record->id,
                        );

                        Notification::make()->title('User restored')->success()->send();
                    }),
            ])
            ->bulkActions([
                Tables\Actions\BulkActionGroup::make([
                    Tables\Actions\DeleteBulkAction::make(),
                ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListUsers::route('/'),
            'create' => Pages\CreateUser::route('/create'),
            'edit' => Pages\EditUser::route('/{record}/edit'),
        ];
    }
}
