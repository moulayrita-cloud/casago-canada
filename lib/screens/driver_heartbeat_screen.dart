import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class DriverHeartbeatScreen extends StatefulWidget {
  const DriverHeartbeatScreen({super.key});

  @override
  State<DriverHeartbeatScreen> createState() => _DriverHeartbeatScreenState();
}

class _DriverHeartbeatScreenState extends State<DriverHeartbeatScreen> {
  final String _baseUrl = 'https://casago-api.azurewebsites.net';
  static const Duration heartbeatInterval = Duration(seconds: 45);

  final TextEditingController _phoneController = TextEditingController();

  Timer? _timer;
  bool _hbBusy = false;

  String _status = 'Idle';
  String? _lastSent;

  @override
  void initState() {
    super.initState();
    _loadSavedPhone().then((_) {
      if (!mounted) return;
      _startHeartbeat();
    });
  }

  void _startHeartbeat() {
    _timer?.cancel();

    // send immediately
    _sendSingleHeartbeat();

    // then repeat
    _timer = Timer.periodic(heartbeatInterval, (_) => _sendSingleHeartbeat());
  }

  Future<void> _sendSingleHeartbeat() async {
    if (_hbBusy) return;
    _hbBusy = true;

    try {
      final phone = _phoneController.text.trim();
      if (phone.isEmpty || !phone.startsWith('+')) {
        if (!mounted) return;
        setState(() => _status = 'Enter phone like +1819...');
        return;
      }

      final ok = await _ensureLocationPermission();
      if (!ok) {
        if (!mounted) return;
        setState(() => _status = 'Location permission denied');
        return;
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      final url = Uri.parse('$_baseUrl/driver/heartbeat');

      final resp = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'phone': phone,
          'lat': pos.latitude,
          'lng': pos.longitude,
        }),
      );

      if (!mounted) return;
      setState(() {
        _lastSent = DateTime.now().toIso8601String();
        _status = resp.statusCode == 200
            ? 'Heartbeat OK'
            : 'Heartbeat FAIL ${resp.statusCode}: ${resp.body}';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'Heartbeat error: $e');
    } finally {
      _hbBusy = false;
    }
  }

Future<void> _loadSavedPhone() async {
  final sp = await SharedPreferences.getInstance();
  final phone = sp.getString('driver_phone') ?? '';

  if (!mounted) return;

  setState(() {
    _phoneController.text = phone;
  });

  if (phone.isEmpty) {
    setState(() => _status = 'Driver phone not registered');
  }
}
  Future<void> _savePhone() async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString('driver_phone', _phoneController.text.trim());
  }

  Future<bool> _ensureLocationPermission() async {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) return false;

    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    return perm == LocationPermission.always ||
        perm == LocationPermission.whileInUse;
  }

  @override
  void dispose() {
    _timer?.cancel();
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Driver Heartbeat')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _phoneController,
              decoration: const InputDecoration(
                labelText: 'Driver phone (E.164)',
                hintText: '+1819...',
              ),
              keyboardType: TextInputType.phone,
              onChanged: (_) => _savePhone(),
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _sendSingleHeartbeat,
              child: const Text('Send once now'),
            ),
            const SizedBox(height: 12),
            Text('Status: $_status'),
            if (_lastSent != null) Text('Last sent: $_lastSent'),
          ],
        ),
      ),
    );
  }
}