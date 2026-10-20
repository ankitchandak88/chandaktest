<?php

namespace App\Filament\Resources;

use App\Filament\Resources\DocumentResource\Pages;
use App\Models\Document;
use App\Services\AuditLogger;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;

/**
 * Metadata-only (docs/06 section 6.2): filename, checksum, processing
 * status - never the extracted page text or file content. No create/edit:
 * documents only ever come from the upload API. Deletion is allowed for
 * abuse/support review, and is audited.
 */
class DocumentResource extends Resource
{
    protected static ?string $model = Document::class;

    protected static ?string $navigationIcon = 'heroicon-o-document';

    protected static ?string $navigationGroup = 'Content';

    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit($record): bool
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
                Tables\Columns\TextColumn::make('organization.name')->searchable(),
                Tables\Columns\TextColumn::make('project.name')->searchable(),
                Tables\Columns\TextColumn::make('original_filename')->searchable(),
                Tables\Columns\TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state) => match ($state) {
                        'ready' => 'success',
                        'processing' => 'warning',
                        'failed' => 'danger',
                        default => 'gray',
                    }),
                Tables\Columns\TextColumn::make('page_count')->numeric(),
                Tables\Columns\TextColumn::make('size_bytes')
                    ->label('Size')
                    ->formatStateUsing(fn ($state) => number_format($state / 1024, 1).' KB'),
                Tables\Columns\TextColumn::make('checksum')->limit(16)->fontFamily('mono'),
                Tables\Columns\TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                Tables\Filters\SelectFilter::make('status')
                    ->options(['processing' => 'Processing', 'ready' => 'Ready', 'failed' => 'Failed']),
            ])
            ->actions([
                Tables\Actions\DeleteAction::make()
                    ->after(function (Document $record) {
                        app(AuditLogger::class)->log(
                            auth()->id(),
                            'admin.document_deleted',
                            'document',
                            $record->id,
                        );
                        Notification::make()->title('Document removed')->success()->send();
                    }),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListDocuments::route('/'),
        ];
    }
}
