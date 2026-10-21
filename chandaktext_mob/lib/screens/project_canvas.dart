import 'dart:async';
import 'package:flutter/material.dart';
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
  });

  final String projectId;
  final List<Excerpt> excerpts;
  final List<ResearchNote> notes;

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

  Future<void> _load() async {
    setState(() => _loading = true);
    final items = await ProjectApi.listWorkspaceItems(widget.projectId);
    final links = await ProjectApi.listLinks(widget.projectId);
    final tags = await ProjectApi.listTags(widget.projectId);
    if (!mounted) return;
    setState(() {
      _items = items;
      _links = links;
      _tags = tags;
      _positions
        ..clear()
        ..addEntries(items.map((i) => MapEntry(i.id, Offset(i.x, i.y))));
      _loading = false;
    });
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
    showModalBottomSheet(
      context: context,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            return Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Assign tags', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 8),
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
      ProjectApi.saveWorkspaceBatch(widget.projectId, [
        {'id': itemId, 'x': pos.dx, 'y': pos.dy},
      ]);
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
          Text(
            card.title,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.bold,
              color: card.kind == 'excerpt' ? Colors.amber : Colors.cyan,
            ),
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
