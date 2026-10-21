import 'dart:async';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';
import 'pdf_reader_screen.dart';

class ProjectDetailScreen extends StatefulWidget {
  const ProjectDetailScreen({super.key, required this.project});

  final Project project;

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  late Future<List<ReaderDocument>> _documents;
  late Future<List<ResearchNote>> _notes;
  late Future<List<Excerpt>> _excerpts;
  bool _uploading = false;
  String? _exportMessage;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  void _reload() {
    _documents = ProjectApi.listDocuments(widget.project.id);
    _notes = ProjectApi.listNotes(widget.project.id);
    _excerpts = ProjectApi.listExcerpts(widget.project.id);
    _scheduleDocumentPoll();
  }

  // Documents move processing -> ready/failed in the background (see
  // ProcessDocumentJob on the backend); poll gently while any loaded
  // document is still processing, same as the web app's refetchInterval.
  void _scheduleDocumentPoll() {
    _pollTimer?.cancel();
    _documents.then((docs) {
      if (!mounted) return;
      if (docs.any((d) => d.status == 'processing')) {
        _pollTimer = Timer(const Duration(milliseconds: 2500), () {
          if (mounted) setState(_reload);
        });
      }
    }).catchError((_) {});
  }

  Future<void> _uploadPdf() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    final path = result?.files.single.path;
    if (path == null) return;

    setState(() => _uploading = true);
    try {
      await ProjectApi.uploadDocument(widget.project.id, File(path));
      setState(_reload);
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _addNote() async {
    final controller = TextEditingController();
    final content = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New note'),
        content: TextField(controller: controller, maxLines: 4, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );

    if (content == null || content.isEmpty) return;

    await ProjectApi.createNote(widget.project.id, content);
    setState(_reload);
  }

  Future<void> _startExport() async {
    setState(() => _exportMessage = 'Export queued…');
    try {
      final job = await ProjectApi.startExport(widget.project.id);
      _pollExport(job['id'] as String);
    } catch (err) {
      setState(() => _exportMessage = apiErrorMessage(err));
    }
  }

  Future<void> _pollExport(String exportId) async {
    for (var i = 0; i < 20; i++) {
      await Future.delayed(const Duration(seconds: 1));
      final job = await ProjectApi.exportStatus(exportId);
      if (job['status'] == 'ready') {
        setState(() => _exportMessage = 'Export ready (download from the web app for now).');
        return;
      }
      if (job['status'] == 'failed') {
        setState(() => _exportMessage = 'Export failed: ${job['failure_reason']}');
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.project.name),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Documents'),
              Tab(text: 'Excerpts'),
              Tab(text: 'Notes'),
            ],
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.ios_share),
              tooltip: 'Export',
              onPressed: _startExport,
            ),
          ],
        ),
        body: Column(
          children: [
            if (_exportMessage != null)
              Container(
                width: double.infinity,
                color: Colors.cyan.withValues(alpha: 0.1),
                padding: const EdgeInsets.all(8),
                child: Text(_exportMessage!, textAlign: TextAlign.center),
              ),
            Expanded(
              child: TabBarView(
                children: [
                  _buildDocumentsTab(),
                  _buildExcerptsTab(),
                  _buildNotesTab(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentsTab() {
    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: () async => setState(_reload),
          child: FutureBuilder<List<ReaderDocument>>(
            future: _documents,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              final documents = snapshot.data ?? [];
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (documents.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 48),
                      child: Center(child: Text('No documents yet. Upload a PDF below.')),
                    ),
                  for (final doc in documents)
                    Card(
                      child: ListTile(
                        title: Text(doc.originalFilename, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                          doc.status == 'ready'
                              ? '${doc.pageCount ?? '?'} pages'
                              : doc.status == 'failed'
                                  ? 'Failed: ${doc.failureReason}'
                                  : 'Processing…',
                        ),
                        onTap: doc.status == 'ready'
                            ? () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => PdfReaderScreen(document: doc),
                                  ),
                                )
                            : null,
                      ),
                    ),
                ],
              );
            },
          ),
        ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton.extended(
            onPressed: _uploading ? null : _uploadPdf,
            icon: _uploading
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.upload_file),
            label: Text(_uploading ? 'Uploading…' : 'Upload PDF'),
          ),
        ),
      ],
    );
  }

  Widget _buildExcerptsTab() {
    return FutureBuilder<List<Excerpt>>(
      future: _excerpts,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        final excerpts = snapshot.data ?? [];
        if (excerpts.isEmpty) {
          return const Center(child: Text('No excerpts yet. Select text in a document to save one.'));
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final excerpt in excerpts)
              Card(
                child: ListTile(
                  title: Text(excerpt.text, maxLines: 3, overflow: TextOverflow.ellipsis),
                  subtitle: Text('Page ${excerpt.pageNumber}'),
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _buildNotesTab() {
    return Stack(
      children: [
        FutureBuilder<List<ResearchNote>>(
          future: _notes,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final notes = snapshot.data ?? [];
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (notes.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: Center(child: Text('No notes yet.')),
                  ),
                for (final note in notes)
                  Card(
                    child: ListTile(
                      title: Text(note.title ?? 'Note'),
                      subtitle: Text(note.content ?? '', maxLines: 3, overflow: TextOverflow.ellipsis),
                    ),
                  ),
              ],
            );
          },
        ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton(onPressed: _addNote, child: const Icon(Icons.add)),
        ),
      ],
    );
  }
}
