import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';
import 'project_detail_screen.dart';

class ProjectsScreen extends StatefulWidget {
  const ProjectsScreen({super.key});

  @override
  State<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends State<ProjectsScreen> {
  List<Project> _projects = [];
  PageMeta? _meta;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  UsageSummary? _usage;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final result = await ProjectApi.listProjects();
      if (!mounted) return;
      setState(() {
        _projects = result.data;
        _meta = result.meta;
        _loading = false;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err;
        _loading = false;
      });
    }

    ProjectApi.usage().then((u) {
      if (mounted) setState(() => _usage = u);
    }).catchError((_) {});
  }

  // BUG-006 (mobile): the backend has always paginated this endpoint (20
  // per page), same as the web app before its fix - without this, any
  // project beyond the 20th is invisible with no indication more exist.
  Future<void> _loadMore() async {
    final meta = _meta;
    if (meta == null || !meta.hasMore || _loadingMore) return;

    setState(() => _loadingMore = true);
    try {
      final result = await ProjectApi.listProjects(page: meta.currentPage + 1);
      if (!mounted) return;
      setState(() {
        _projects = [..._projects, ...result.data];
        _meta = result.meta;
        _loadingMore = false;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(apiErrorMessage(err))),
      );
    }
  }

  Future<void> _createProject() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New project'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Project name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );

    if (name == null || name.isEmpty) return;

    try {
      await ProjectApi.createProject(name);
      _load();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(apiErrorMessage(err))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Projects'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AuthProvider>().logout(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _createProject,
        child: const Icon(Icons.add),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Text(apiErrorMessage(_error!)))
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_usage != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text(
                            '${_usage!.projectsUsed} / ${_usage!.projectsLimit} projects on the '
                            '${_usage!.plan} plan',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      if (_projects.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 48),
                          child: Center(child: Text('No projects yet. Tap + to create one.')),
                        ),
                      for (final project in _projects)
                        Card(
                          child: ListTile(
                            title: Text(project.name),
                            subtitle: Text(
                              '${project.documentsCount} documents · ${project.excerptsCount} excerpts · '
                              '${project.notesCount} notes',
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () async {
                              // Document/excerpt/note counts can change while
                              // the user is inside the project (upload, add
                              // note, etc.) - refresh this list on return
                              // rather than showing stale counts indefinitely.
                              await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => ProjectDetailScreen(project: project),
                                ),
                              );
                              if (mounted) _load();
                            },
                          ),
                        ),
                      if (_meta?.hasMore ?? false)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: Center(
                            child: _loadingMore
                                ? const CircularProgressIndicator()
                                : OutlinedButton(
                                    onPressed: _loadMore,
                                    child: Text('Load more (${_projects.length} of ${_meta!.total})'),
                                  ),
                          ),
                        ),
                    ],
                  ),
      ),
    );
  }
}
