<html>
<head>
<meta charset="UTF-8">
<style>
    body { font-family: sans-serif; font-size: 11pt; }
    h1 { font-size: 16pt; margin-bottom: 0; }
    .exported-at { font-size: 9pt; color: #555; margin-top: 4px; }
    h2 { font-size: 13pt; margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .item { margin-bottom: 12px; }
    .source { font-size: 9pt; font-style: italic; color: #555; margin-bottom: 2px; }
    .note-title { font-weight: bold; margin-bottom: 2px; }
</style>
</head>
<body>
    <h1>{{ $project->name }}</h1>
    <p class="exported-at">Exported {{ now()->toDayDateTimeString() }}</p>

    @if ($project->excerpts->isNotEmpty())
        <h2>Excerpts</h2>
        @foreach ($project->excerpts as $excerpt)
            <div class="item">
                <p class="source">Source: {{ $excerpt->document->original_filename ?? 'Unknown source' }}, page {{ $excerpt->page_number }}</p>
                <p>{{ $excerpt->text }}</p>
            </div>
        @endforeach
    @endif

    @if ($project->notes->isNotEmpty())
        <pagebreak />
        <h2>Notes</h2>
        @foreach ($project->notes as $note)
            <div class="item">
                @if ($note->title)
                    <p class="note-title">{{ $note->title }}</p>
                @endif
                <p>{{ $note->content }}</p>
            </div>
        @endforeach
    @endif
</body>
</html>
