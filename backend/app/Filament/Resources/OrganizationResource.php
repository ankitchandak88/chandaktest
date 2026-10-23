<?php

namespace App\Filament\Resources;

use App\Filament\Resources\OrganizationResource\Pages;
use App\Models\Organization;
use App\Services\AuditLogger;
use App\Services\EntitlementService;
use Filament\Forms;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;

class OrganizationResource extends Resource
{
    protected static ?string $model = Organization::class;

    protected static ?string $navigationIcon = 'heroicon-o-building-office-2';

    protected static ?string $navigationGroup = 'Accounts';

    public static function form(Form $form): Form
    {
        return $form
            ->schema([
                Forms\Components\TextInput::make('name')->required()->maxLength(255),
                Forms\Components\TextInput::make('slug')->required()->maxLength(255)->unique(ignoreRecord: true),
                Forms\Components\Select::make('status')
                    ->options(['active' => 'Active', 'suspended' => 'Suspended'])
                    ->required(),
                Forms\Components\TextInput::make('suspended_reason')->maxLength(255),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('name')->searchable(),
                Tables\Columns\TextColumn::make('slug')->searchable(),
                Tables\Columns\TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state) => $state === 'active' ? 'success' : 'danger'),
                Tables\Columns\TextColumn::make('subscription.plan.name')->label('Plan')->default('Solo Advocate (Free)'),
                Tables\Columns\TextColumn::make('memberships_count')
                    ->label('Advocate Seats')
                    ->state(fn (Organization $record) => $record->memberships()->count().' / '.app(EntitlementService::class)->planFor($record)->limit('seats', 1)),
                Tables\Columns\TextColumn::make('projects_count')->counts('projects')->label('Cases'),
                Tables\Columns\TextColumn::make('storage_used')
                    ->label('Storage Quota')
                    ->state(fn (Organization $record) => number_format(
                        app(EntitlementService::class)->storageUsedBytes($record) / 1048576,
                        1
                    ).' / '.app(EntitlementService::class)->planFor($record)->limit('storage_mb', 1000).' MB'),
                Tables\Columns\TextColumn::make('created_at')->dateTime()->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                Tables\Filters\SelectFilter::make('status')
                    ->options(['active' => 'Active', 'suspended' => 'Suspended']),
            ])
            ->actions([
                Tables\Actions\EditAction::make(),
                Tables\Actions\Action::make('change_plan')
                    ->label('Change Plan')
                    ->icon('heroicon-o-arrow-up-circle')
                    ->color('warning')
                    ->form([
                        Forms\Components\Select::make('plan_id')
                            ->label('Select Advocate Plan')
                            ->options(\App\Models\Plan::pluck('name', 'id'))
                            ->required(),
                    ])
                    ->action(function (Organization $record, array $data) {
                        $plan = \App\Models\Plan::findOrFail($data['plan_id']);
                        $subscription = $record->subscription;
                        if ($subscription) {
                            $subscription->update(['plan_id' => $plan->id, 'status' => 'active']);
                        } else {
                            \App\Models\Subscription::create([
                                'organization_id' => $record->id,
                                'plan_id' => $plan->id,
                                'provider' => 'manual',
                                'provider_subscription_id' => 'admin_assigned_'.\Illuminate\Support\Str::random(8),
                                'status' => 'active',
                            ]);
                        }
                        Notification::make()->title("Firm upgraded to {$plan->name}")->success()->send();
                    }),
                Tables\Actions\Action::make('suspend')
                    ->visible(fn (Organization $record) => $record->status === 'active')
                    ->requiresConfirmation()
                    ->icon('heroicon-o-no-symbol')
                    ->color('danger')
                    ->form([Forms\Components\Textarea::make('reason')->required()])
                    ->action(function (Organization $record, array $data) {
                        $record->update([
                            'status' => 'suspended',
                            'suspended_reason' => $data['reason'],
                            'suspended_at' => now(),
                        ]);

                        app(AuditLogger::class)->log(
                            auth()->id(),
                            'admin.organization_suspended',
                            'organization',
                            $record->id,
                            ['reason' => $data['reason']]
                        );

                        Notification::make()->title('Organization suspended')->success()->send();
                    }),
                Tables\Actions\Action::make('restore_access')
                    ->label('Restore')
                    ->visible(fn (Organization $record) => $record->status === 'suspended')
                    ->requiresConfirmation()
                    ->icon('heroicon-o-check-circle')
                    ->color('success')
                    ->action(function (Organization $record) {
                        $record->update(['status' => 'active', 'suspended_reason' => null, 'suspended_at' => null]);

                        app(AuditLogger::class)->log(
                            auth()->id(),
                            'admin.organization_restored',
                            'organization',
                            $record->id,
                        );

                        Notification::make()->title('Organization restored')->success()->send();
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
            'index' => Pages\ListOrganizations::route('/'),
            'create' => Pages\CreateOrganization::route('/create'),
            'edit' => Pages\EditOrganization::route('/{record}/edit'),
        ];
    }
}
