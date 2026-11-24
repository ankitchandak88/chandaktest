import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/project_api.dart';
import '../models/models.dart';

T? _findFirst<T>(Iterable<T> items, bool Function(T) test) {
  for (final item in items) {
    if (test(item)) return item;
  }
  return null;
}

class _CanvasCard {
  final WorkspaceItem item;
  final String kind; // 'excerpt' | 'note'
  final String targetId;
  final String title;
  final String body;
  final List<Tag> tags;

  _CanvasCard({
    required this.item,
    required this.kind,
    required this.targetId,
    required this.title,
    required this.body,
    required this.tags,
  });
}

/// Phase 7: mobile canvas editing, matching web's WorkspaceCanvas.tsx -
/// drag positioning (debounced autosave via the same workspace-items/batch
/// endpoint) and tap-to-link.
///
/// Verified live on-device that a plain GestureDetector(onPanUpdate:) does
/// NOT reliably win against the ancestor SingleChildScrollViews' own drag
/// recognizers - ancestor Scrollables and a descendant's pan recognizer are
/// peers in Flutter's gesture arena, and the scroll view kept the gesture
/// instead of the card (a well-known Flutter limitation, not a bug in this
/// code). LongPressDraggable sidesteps it: its delayed multi-drag
/// recognizer only claims the arena after a hold, so a quick tap still
/// falls through to the card's own tap handler (used for link-mode) while
/// a hold-and-move reliably drags the card even inside nested scroll
/// views. Trade-off: moving a card now requires a brief hold first, same
/// "plain divs, not a canvas library" category of simplification
/// web/src/components/WorkspaceCanvas.tsx documents for its own first pass.
class ProjectCanvas extends StatefulWidget {
  const ProjectCanvas({
    super.key,
    required this.projectId,
    required this.excerpts,
    required this.notes,
    this.onTagsChanged,
    this.onNavigateToExcerpt,
  });

  final String projectId;
  final List<Excerpt> excerpts;
  final List<ResearchNote> notes;

  /// LiquidText 2-Way Navigation: tapping "View in Doc" jumps straight to the source page
  final ValueChanged<Excerpt>? onNavigateToExcerpt;

  /// Phase 8: tags live on the Excerpt/ResearchNote objects the parent
  /// (ProjectDetailScreen) owns and fetches - this canvas doesn't have its
  /// own copy to mutate, so after any tag change it asks the parent to
  /// reload, which re-fetches excerpts/notes (with fresh tags) and passes
  /// updated props back down.
  final VoidCallback? onTagsChanged;

  @override
  State<ProjectCanvas> createState() => _ProjectCanvasState();
}

class _ProjectCanvasState extends State<ProjectCanvas> {
  static const double canvasWidth = 2400;
  static const double canvasHeight = 2400;

  List<WorkspaceBoard> _workspaces = [];
  String? _activeWorkspaceId;
  List<WorkspaceItem> _items = [];
  List<ProjectLink> _links = [];
  List<Tag> _tags = [];
  bool _loading = true;
  final Map<String, Offset> _positions = {};
  String? _linkSourceItemId;
  Timer? _saveTimer;
  final GlobalKey _stackKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    super.dispose();
  }

  Future<void> _load({String? targetWorkspaceId}) async {
    setState(() => _loading = true);
    final workspaces = await ProjectApi.listWorkspaces(widget.projectId);
    final activeId = targetWorkspaceId ??
        _activeWorkspaceId ??
        (workspaces.isNotEmpty ? workspaces.first.id : null);
    final items = await ProjectApi.listWorkspaceItems(
      widget.projectId,
      workspaceId: activeId,
    );
    final links = await ProjectApi.listLinks(widget.projectId);
    final tags = await ProjectApi.listTags(widget.projectId);
    if (!mounted) return;
    setState(() {
      _workspaces = workspaces;
      _activeWorkspaceId = activeId;
      _items = items;
      _links = links;
      _tags = tags;
      _positions
        ..clear()
        ..addEntries(items.map((i) => MapEntry(i.id, Offset(i.x, i.y))));
      _loading = false;
    });
  }

  void _selectWorkspace(String workspaceId) {
    if (_activeWorkspaceId == workspaceId) return;
    _load(targetWorkspaceId: workspaceId);
  }

  Color _parseColor(String? hexString) {
    if (hexString == null || hexString.isEmpty) return const Color(0xff3b82f6);
    final clean = hexString.replaceFirst('#', '');
    if (clean.length == 6) {
      return Color(int.tryParse('ff$clean', radix: 16) ?? 0xff3b82f6);
    }
    return const Color(0xff3b82f6);
  }

  void _showCreateBoardDialog() {
    final controller = TextEditingController();
    String selectedColor = '#3b82f6';
    final colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#06b6d4'];

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xff0f172a),
              title: const Text('Create Workspace Board', style: TextStyle(color: Colors.white, fontSize: 16)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Organize research into separate themed boards (LiquidText Lesson 7).',
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: controller,
                    autofocus: true,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Board Name',
                      hintText: 'e.g. Chronology, Cross Exam',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('Accent Color', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white70)),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      for (final hex in colors)
                        GestureDetector(
                          onTap: () => setDialogState(() => selectedColor = hex),
                          child: Container(
                            width: 28,
                            height: 28,
                            decoration: BoxDecoration(
                              color: _parseColor(hex),
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: selectedColor == hex ? Colors.white : Colors.transparent,
                                width: 2.5,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
                ),
                FilledButton(
                  onPressed: () async {
                    final name = controller.text.trim();
                    if (name.isEmpty) return;
                    Navigator.pop(ctx);
                    final created = await ProjectApi.createWorkspace(
                      widget.projectId,
                      name: name,
                      color: selectedColor,
                    );
                    _load(targetWorkspaceId: created.id);
                  },
                  child: const Text('Create Board'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _createTag(String name) async {
    if (name.trim().isEmpty) return;
    final tag = await ProjectApi.createTag(widget.projectId, name.trim());
    if (!mounted) return;
    setState(() => _tags = [..._tags, tag]);
  }

  Future<void> _deleteTag(Tag tag) async {
    await ProjectApi.deleteTag(tag.id);
    if (!mounted) return;
    setState(() => _tags = _tags.where((t) => t.id != tag.id).toList());
    widget.onTagsChanged?.call();
  }

  void _showGlossarySheet() async {
    final terms = await ProjectApi.listPhraseDefinitions(widget.projectId);
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xff0f172a),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        String query = '';
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            final filtered = terms
                .where((t) =>
                    t.term.toLowerCase().contains(query.toLowerCase()) ||
                    t.definition.toLowerCase().contains(query.toLowerCase()))
                .toList();

            return Container(
              height: MediaQuery.of(ctx).size.height * 0.75,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.between,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.menu_book, color: Colors.amber, size: 20),
                          SizedBox(width: 8),
                          Text(
                            'Defined Terms Glossary',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                          ),
                        ],
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.grey),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'Search terms (e.g. Borrower, Closing Date)...',
                      hintStyle: const TextStyle(color: Colors.grey, fontSize: 12),
                      prefixIcon: const Icon(Icons.search, size: 18, color: Colors.grey),
                      filled: true,
                      fillColor: const Color(0xff1e293b),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    ),
                    onChanged: (val) => setSheetState(() => query = val),
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: filtered.isEmpty
                        ? const Center(
                            child: Text(
                              'No defined terms found.\nUse the web app to auto-scan or add definitions.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.grey, fontSize: 12),
                            ),
                          )
                        : ListView.separated(
                            itemCount: filtered.length,
                            separatorBuilder: (_, __) => const Divider(color: Color(0xff334155)),
                            itemBuilder: (_, i) {
                              final item = filtered[i];
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Row(
                                  children: [
                                    Text(
                                      '"${item.term}"',
                                      style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 13),
                                    ),
                                    if (item.pageNumber != null) ...[
                                      const SizedBox(width: 8),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xff334155),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text('p. ${item.pageNumber}', style: const TextStyle(color: Colors.white70, fontSize: 10)),
                                      ),
                                    ],
                                  ],
                                ),
                                subtitle: Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(
                                    item.definition,
                                    style: const TextStyle(color: Colors.white70, fontSize: 12, height: 1.3),
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _showTagManager() {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(sheetContext).viewInsets.bottom),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Project tags', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: controller,
                          decoration: const InputDecoration(hintText: 'New tag name'),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.add),
                        onPressed: () async {
                          final name = controller.text;
                          controller.clear();
                          await _createTag(name);
                          setSheetState(() {});
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_tags.isEmpty) const Text('No tags yet.', style: TextStyle(color: Colors.grey)),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final tag in _tags)
                        Chip(
                          label: Text(tag.name),
                          onDeleted: () async {
                            await _deleteTag(tag);
                            setSheetState(() {});
                          },
                        ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _showTagPicker(_CanvasCard card) {
    final selected = card.tags.map((t) => t.id).toSet();
    List<String> suggestions = [];
    bool suggesting = false;

    showModalBottomSheet(
      context: context,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            Future<void> acceptSuggestion(String name) async {
              var tag = _findFirst(_tags, (t) => t.name.toLowerCase() == name.toLowerCase());
              tag ??= await ProjectApi.createTag(widget.projectId, name);
              if (!_tags.any((t) => t.id == tag!.id)) {
                setState(() => _tags = [..._tags, tag!]);
              }
              setSheetState(() {
                selected.add(tag!.id);
                suggestions = suggestions.where((s) => s != name).toList();
              });
              if (card.kind == 'excerpt') {
                await ProjectApi.syncExcerptTags(card.targetId, selected.toList());
              } else {
                await ProjectApi.syncNoteTags(card.targetId, selected.toList());
              }
            }

            return Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text('Assign tags', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.auto_awesome, size: 14),
                        label: Text(suggesting ? 'Thinking…' : 'Suggest'),
                        onPressed: suggesting
                            ? null
                            : () async {
                                setSheetState(() => suggesting = true);
                                final names = card.kind == 'excerpt'
                                    ? await ProjectApi.suggestExcerptTags(card.targetId)
                                    : await ProjectApi.suggestNoteTags(card.targetId);
                                setSheetState(() {
                                  suggestions = names;
                                  suggesting = false;
                                });
                              },
                      ),
                    ],
                  ),
                  if (suggestions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Wrap(
                        spacing: 6,
                        children: [
                          for (final name in suggestions)
                            ActionChip(
                              label: Text('+ $name'),
                              onPressed: () => acceptSuggestion(name),
                            ),
                        ],
                      ),
                    ),
                  if (_tags.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Text('No project tags yet. Create one from the Tags button above the canvas.'),
                    ),
                  for (final tag in _tags)
                    CheckboxListTile(
                      title: Text(tag.name),
                      value: selected.contains(tag.id),
                      onChanged: (checked) async {
                        setSheetState(() {
                          if (checked ?? false) {
                            selected.add(tag.id);
                          } else {
                            selected.remove(tag.id);
                          }
                        });
                        if (card.kind == 'excerpt') {
                          await ProjectApi.syncExcerptTags(card.targetId, selected.toList());
                        } else {
                          await ProjectApi.syncNoteTags(card.targetId, selected.toList());
                        }
                      },
                    ),
                ],
              ),
            );
          },
        );
      },
    ).then((_) => widget.onTagsChanged?.call());
  }

  void _scheduleSave(String itemId, Offset pos) {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 400), () {
      ProjectApi.saveWorkspaceBatch(
        widget.projectId,
        [
          {'id': itemId, 'x': pos.dx, 'y': pos.dy},
        ],
        workspaceId: _activeWorkspaceId,
      );
    });
  }

  Future<void> _handleCardTap(_CanvasCard card) async {
    final sourceId = _linkSourceItemId;
    if (sourceId == null) {
      setState(() => _linkSourceItemId = card.item.id);
      return;
    }
    if (sourceId == card.item.id) {
      setState(() => _linkSourceItemId = null);
      return;
    }

    final sourceItem = _findFirst(_items, (i) => i.id == sourceId);
    setState(() => _linkSourceItemId = null);
    if (sourceItem == null) return;

    await ProjectApi.createLink(
      widget.projectId,
      sourceType: sourceItem.itemType,
      sourceId: sourceItem.targetId,
      targetType: card.kind,
      targetId: card.targetId,
    );
    _load();
  }

  List<_CanvasCard> _buildCards() {
    final cards = <_CanvasCard>[];
    for (final item in _items) {
      if (item.itemType == 'excerpt') {
        final excerpt = _findFirst(widget.excerpts, (e) => e.id == item.targetId);
        if (excerpt != null) {
          cards.add(_CanvasCard(
            item: item,
            kind: 'excerpt',
            targetId: excerpt.id,
            title: 'Page ${excerpt.pageNumber}',
            body: excerpt.text,
            tags: excerpt.tags,
          ));
        }
      } else {
        final note = _findFirst(widget.notes, (n) => n.id == item.targetId);
        if (note != null) {
          cards.add(_CanvasCard(
            item: item,
            kind: 'note',
            targetId: note.id,
            title: note.title ?? 'Note',
            body: note.content ?? '',
            tags: note.tags,
          ));
        }
      }
    }
    return cards;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    final cards = _buildCards();

    return Column(
      children: [
        // LiquidText Lesson 7: Multiple Workspaces / Boards Strip
        if (_workspaces.isNotEmpty)
          Container(
            height: 48,
            color: const Color(0xff0f172a),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final ws in _workspaces)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      selected: ws.id == _activeWorkspaceId,
                      showCheckmark: false,
                      avatar: Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _parseColor(ws.color),
                          shape: BoxShape.circle,
                        ),
                      ),
                      label: Text(
                        ws.name,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: ws.id == _activeWorkspaceId ? FontWeight.bold : FontWeight.normal,
                          color: ws.id == _activeWorkspaceId ? Colors.white : Colors.grey.shade400,
                        ),
                      ),
                      selectedColor: const Color(0xff1e293b),
                      backgroundColor: const Color(0xff0f172a),
                      side: BorderSide(
                        color: ws.id == _activeWorkspaceId ? const Color(0xff334155) : Colors.transparent,
                      ),
                      onSelected: (selected) {
                        if (selected) _selectWorkspace(ws.id);
                      },
                    ),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.add, size: 14, color: Colors.tealAccent),
                  label: const Text('New Board', style: TextStyle(fontSize: 12, color: Colors.white70)),
                  backgroundColor: const Color(0xff1e293b),
                  side: const BorderSide(color: Color(0xff334155)),
                  onPressed: _showCreateBoardDialog,
                ),
              ],
            ),
          ),
        if (_linkSourceItemId == null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                if (cards.isNotEmpty)
                  Expanded(
                    child: Text(
                      'Tap a card to start linking it. Hold and drag to move it.',
                      style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                    ),
                  )
                else
                  const Spacer(),
                TextButton.icon(
                  onPressed: _showGlossarySheet,
                  icon: const Icon(Icons.menu_book, size: 16, color: Colors.amber),
                  label: const Text('Glossary', style: TextStyle(color: Colors.amber, fontSize: 12)),
                ),
                TextButton.icon(
                  onPressed: _showTagManager,
                  icon: const Icon(Icons.label_outline, size: 16),
                  label: const Text('Tags'),
                ),
              ],
            ),
          ),
        if (_linkSourceItemId != null)
          Container(
            width: double.infinity,
            color: Colors.cyan.withValues(alpha: 0.15),
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                const Expanded(
                  child: Text('Tap another card to link it.', style: TextStyle(fontSize: 12)),
                ),
                TextButton(
                  onPressed: () => setState(() => _linkSourceItemId = null),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          ),
        if (cards.isEmpty)
          const Expanded(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Nothing on the canvas yet. Save an excerpt or add a note to place a card here.',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          )
        else
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: SingleChildScrollView(
                scrollDirection: Axis.vertical,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SizedBox(
                    width: canvasWidth,
                    height: canvasHeight,
                    child: Stack(
                      key: _stackKey,
                      children: [
                        CustomPaint(
                          size: const Size(canvasWidth, canvasHeight),
                          painter: _LinkPainter(links: _links, cards: cards, positions: _positions),
                        ),
                        for (final card in cards) _buildCard(card),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildCard(_CanvasCard card) {
    final pos = _positions[card.item.id] ?? Offset(card.item.x, card.item.y);
    final isLinkSource = _linkSourceItemId == card.item.id;

    return Positioned(
      left: pos.dx,
      top: pos.dy,
      width: card.item.width,
      child: LongPressDraggable<String>(
        data: card.item.id,
        feedback: Material(
          color: Colors.transparent,
          child: SizedBox(
            width: card.item.width,
            child: _cardContent(card, isLinkSource: false, dragging: true, showActions: false),
          ),
        ),
        childWhenDragging: Opacity(
          opacity: 0.3,
          child: _cardContent(card, isLinkSource: isLinkSource, dragging: false, showActions: false),
        ),
        onDragEnd: (details) {
          final stackBox = _stackKey.currentContext?.findRenderObject() as RenderBox?;
          if (stackBox == null) return;
          final local = stackBox.globalToLocal(details.offset);
          setState(() => _positions[card.item.id] = local);
          _scheduleSave(card.item.id, local);
        },
        child: GestureDetector(
          onTap: () => _handleCardTap(card),
          child: _cardContent(card, isLinkSource: isLinkSource, dragging: false, showActions: true),
        ),
      ),
    );
  }

  Widget _cardContent(
    _CanvasCard card, {
    required bool isLinkSource,
    required bool dragging,
    required bool showActions,
  }) {
    return Container(
      padding: const EdgeInsets.all(10),
      constraints: BoxConstraints(minHeight: card.item.height),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        border: Border.all(color: isLinkSource ? Colors.cyan : Colors.grey.shade700),
        borderRadius: BorderRadius.circular(8),
        boxShadow: dragging
            ? [BoxShadow(color: Colors.black.withValues(alpha: 0.5), blurRadius: 12)]
            : const [BoxShadow(color: Colors.black38, blurRadius: 4)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  card.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: card.kind == 'excerpt' ? Colors.amber : Colors.cyan,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (card.kind == 'excerpt' && widget.onNavigateToExcerpt != null)
                    GestureDetector(
                      onTap: () {
                        final exc = _findFirst(widget.excerpts, (e) => e.id == card.targetId);
                        if (exc != null) widget.onNavigateToExcerpt!(exc);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.blue.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: Colors.blue.shade400, width: 0.5),
                        ),
                        child: const Text('📄 Doc ➜', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.cyanAccent)),
                      ),
                    ),
                  const SizedBox(width: 4),
                  InkWell(
                    onTap: () {
                      final citation = '"${card.body.trim()}" — ${card.title}\nchandaktext://projects/${widget.projectId}?card=${card.item.id}';
                      Clipboard.setData(ClipboardData(text: citation));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Citation & Deep Link copied!'),
                          duration: Duration(seconds: 2),
                        ),
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.white10,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: Colors.white24, width: 0.5),
                      ),
                      child: const Text('📋 Link', style: TextStyle(fontSize: 9, color: Colors.white70)),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            card.body,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, color: Colors.white),
          ),
          if (card.tags.isNotEmpty || showActions) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 4,
              runSpacing: 2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (final tag in card.tags)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade800,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(tag.name, style: const TextStyle(fontSize: 9, color: Colors.white70)),
                  ),
                if (showActions)
                  GestureDetector(
                    onTap: () => _showTagPicker(card),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey.shade700),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Text('+ tag', style: TextStyle(fontSize: 9, color: Colors.grey)),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _LinkPainter extends CustomPainter {
  final List<ProjectLink> links;
  final List<_CanvasCard> cards;
  final Map<String, Offset> positions;

  _LinkPainter({required this.links, required this.cards, required this.positions});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF22D3EE)
      ..strokeWidth = 1.5;

    for (final link in links) {
      final source = _findFirst(cards, (c) => c.kind == link.sourceType && c.targetId == link.sourceId);
      final target = _findFirst(cards, (c) => c.kind == link.targetType && c.targetId == link.targetId);
      if (source == null || target == null) continue;

      final from = positions[source.item.id] ?? Offset(source.item.x, source.item.y);
      final to = positions[target.item.id] ?? Offset(target.item.x, target.item.y);

      canvas.drawLine(
        from + Offset(source.item.width / 2, source.item.height / 2),
        to + Offset(target.item.width / 2, target.item.height / 2),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _LinkPainter oldDelegate) => true;
}
