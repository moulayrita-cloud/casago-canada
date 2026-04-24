// lib/screens/find_driver_screen.dart
import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

// Use localhost for Windows, Ngrok for mobile
const String baseUrl = 'https://casago-api.azurewebsites.net';
//const String baseUrl = 'http://localhost:4243';

//const String baseUrl = 'https://39241e1f3416.ngrok-free.app';
const headers = {'Content-Type': 'application/json'};

class FindDriverPage extends StatefulWidget {
  final String pickup;
  final String destination;
  final double? pickupLat;
  final double? pickupLng;
  final String riderName;
  final String riderPhone;
  final String selectedVehicleType;

  const FindDriverPage({
    super.key,
    required this.pickup,
    required this.destination,
    required this.riderName,
    required this.riderPhone,
    required this.selectedVehicleType,
    this.pickupLat,
    this.pickupLng,
  });

  @override
  State<FindDriverPage> createState() => _FindDriverPageState();
}

class _FindDriverPageState extends State<FindDriverPage> {
  String status = 'Searching…';
  String? jobId;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _startSearch();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

Future<void> _startSearch() async {
  debugPrint('🚨 FIND_DRIVER_SCREEN _startSearch CALLED 🚨');

  setState(() => status = 'Starting search…');
  try {
    final body = {
      'pickup': widget.pickup,
      'destination': widget.destination,
      'riderName': widget.riderName,
      'riderPhone': widget.riderPhone,
      'type_vehicle': widget.selectedVehicleType,
      if (widget.pickupLat != null) 'pickupLat': widget.pickupLat,
      if (widget.pickupLng != null) 'pickupLng': widget.pickupLng,
    };

    debugPrint("BODY JSON = ${jsonEncode(body)}");
    final baseUrl = dotenv.env['API_BASE_URL']!;
    final url = Uri.parse('$baseUrl/notify-driver');

    debugPrint("NOTIFY URL = $url");
    debugPrint("BODY JSON = ${jsonEncode(body)}");
    debugPrint("🚨 FIND_DRIVER_SCREEN ACTIVE - sending notify-driver 🚨");
    print('BODY TO SEND: $body');

    final r = await http.post(
      url,
      headers: headers,
      body: jsonEncode(body),
    );

    debugPrint("notify-driver HTTP ${r.statusCode}: ${r.body}");

    final j = jsonDecode(r.body);

    if (r.statusCode == 200 && j['ok'] == true) {
      jobId = j['jobId'];
      setState(() => status = 'Searching for drivers…');
      _poll = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
      await _refresh();
    } else {
      throw Exception(j['error'] ?? 'notify-driver failed');
    }
  } catch (e) {
    setState(() => status = 'Error starting search: $e');
  }
}

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Finding Driver')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            status,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18),
          ),
        ),
      ),
    );
  }
}
