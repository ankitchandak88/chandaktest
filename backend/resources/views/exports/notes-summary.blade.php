<html>
<head>
<meta charset="UTF-8">
<style>
    body { font-family: sans-serif; font-size: 11pt; }
    h2 { font-size: 13pt; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .item { margin-bottom: 12px; }
    .note-title { font-weight: bold; margin-bottom: 2px; }
</style>
</head>
<body>
    <h2>Notes</h2>
    @foreach ($notes as $note)
        <div class="item">
            @if ($note->title)
                <p class="note-title">{{ $note->title }}</p>
            @endif
            <p>{{ $note->content }}</p>
        </div>
    @endforeach
</body>
</html>
