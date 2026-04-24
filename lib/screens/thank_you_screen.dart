// lib/screens/thank_you_screen.dart
import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'distance_screen.dart';

class ThankYouScreen extends StatefulWidget {
  final String pickup;
  final String destination;
  final String riderName;
  final String riderPhone;
  final double amount;
  final String typeVehicle;
  final double pickupLat;
  final double pickupLng;

  const ThankYouScreen({
    super.key,
    required this.pickup,
    required this.destination,
    required this.riderName,
    required this.riderPhone,
    required this.amount,
    required this.typeVehicle,
    required this.pickupLat,
    required this.pickupLng,
  });

  @override
  State<ThankYouScreen> createState() => _ThankYouScreenState();
}

class _ThankYouScreenState extends State<ThankYouScreen> {
  bool isSending = false;
  bool sent = false;

  @override
  void initState() {
    super.initState();
    _notifyDriver();
  }

  Future<void> _notifyDriver() async {
    if (!mounted) return;

    setState(() => isSending = true);

    try {

      final baseUrl = dotenv.env['API_BASE_URL']!;
      final url = Uri.parse('$baseUrl/notify-driver');
      debugPrint('amount=${widget.amount} (${widget.amount.runtimeType})');

    debugPrint('THANKYOU typeVehicle=${widget.typeVehicle}');
debugPrint('THANKYOU BODY=${jsonEncode({
  'pickup': widget.pickup,
  'destination': widget.destination,
  'riderName': widget.riderName,
  'riderPhone': widget.riderPhone,
  'amount': widget.amount,
  'type_vehicle': widget.typeVehicle,
  'etaMinutes': 7,
  'pickupLat': widget.pickupLat,
  'pickupLng': widget.pickupLng,
})}');
    final res = await http.post(
  url,
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'pickup': widget.pickup,
    'destination': widget.destination,
    'riderName': widget.riderName,
    'riderPhone': widget.riderPhone,

    // REQUIRED
    'amount': widget.amount,

    'type_vehicle': widget.typeVehicle,
    'etaMinutes': 7,
    'pickupLat': widget.pickupLat,
    'pickupLng': widget.pickupLng,
  }),
);


      if (!mounted) return;

      if (res.statusCode != 200) {
        throw Exception("HTTP ${res.statusCode}: ${res.body}");
      }

      final data = jsonDecode(res.body);

      if (data['ok'] == true) {
        if (!mounted) return;
        setState(() => sent = true);
      } else {
        throw Exception(data['error'] ?? 'Unknown error');
      }
    } catch (e) {
      debugPrint('Driver notification failed: $e');
    } finally {
      if (!mounted) return;
      setState(() => isSending = false);
    }
  }

  void _goHome() {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const DistanceScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final text = sent
        ? 'Thank you for choosing CasaGo!\nYour driver will contact you shortly.'
        : 'Processing your ride...';

    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                sent ? Icons.check_circle : Icons.directions_car,
                color: sent ? Colors.green : Colors.blue,
                size: 100,
              ),
              const SizedBox(height: 20),
              Text(
                text,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18),
              ),
              const SizedBox(height: 30),
              if (isSending)
                const CircularProgressIndicator()
              else
                ElevatedButton(
                  onPressed: _goHome,
                  child: const Text('Back to Home'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
