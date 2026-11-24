import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';

/// Phase 10: mirrors web/src/components/ShareManager.tsx - create/list/
/// revoke share links. The actual public share page only exists on the web
/// app (web/src/pages/SharePage.tsx) - there's no mobile deep link for it,
/// so this just gives the user a URL to copy and send however they like,
/// same as the "copy the link" affordance web itself offers.
class ShareManager extends StatefulWidget {
  const ShareManager({super.key, required this.projectId});

  final String projectId;

  @override
  State<ShareManager> createState() => _ShareManagerState();
}

const _webUrl = String.fromEnvironment('WEB_URL', defaultValue: 'http://10.0.2.2:5173');

class _ShareManagerState extends State<ShareManager> {
  List<ProjectShare> _shares = [];
  bool _loading = true;
  bool _creating = false;
  String? _error;
  final _passwordController = TextEditingController();
  final _daysController = TextEditingController(text: '7');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _passwordController.dispose();
    _daysController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final shares = await ProjectApi.listShares(widget.projectId);
    if (!mounted) return;
    setState(() {
      _shares = shares.where((s) => s.isActive).toList();
      _loading = false;
    });
  }

  Future<void> _create() async {
    setState(() {
      _creating = true;
      _error = null;
    });
    try {
      final share = await ProjectApi.createShare(
        widget.projectId,
        password: _passwordController.text.trim().isEmpty ? null : _passwordController.text.trim(),
        expiresInDays: int.tryParse(_daysController.text),
      );
      _passwordController.clear();
      await Clipboard.setData(ClipboardData(text: '$_webUrl/share/${share.token}'));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Share link copied to clipboard.')),
      );
      await _load();
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = apiErrorMessage(err, fallback: 'Could not create the share link.'));
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _revoke(ProjectShare share) async {
    await ProjectApi.revokeShare(share.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Share links', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 4),
          const Text(
            'Read-only view of this project\'s notes and excerpts - never the source PDF.',
            style: TextStyle(fontSize: 11, color: Colors.grey),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _passwordController,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Optional password', isDense: true),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _daysController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Expires in days', isDense: true),
          ),
          const SizedBox(height: 8),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
            ),
          FilledButton(
            onPressed: _creating ? null : _create,
            child: Text(_creating ? 'Creating…' : 'Create link (copies to clipboard)'),
          ),
          const SizedBox(height: 16),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_shares.isEmpty)
            const Text('No active share links.', style: TextStyle(color: Colors.grey))
          else
            for (final share in _shares)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text('Expires ${share.expiresAt.toLocal().toString().split(' ').first}'),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                  onPressed: () => _revoke(share),
                ),
              ),
        ],
      ),
    );
  }
}
