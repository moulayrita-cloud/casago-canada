// lib/screens/payment_screen.dart
import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'payment_webview_screen.dart';

// Use localhost for Windows, Ngrok for mobile
//const String baseUrl = 'http://localhost:4243';

const String baseUrl = bool.hasEnvironment('FLUTTER_TEST')
    ? 'http://localhost:4243'
    : 'https://casago-api.azurewebsites.net';


class PaymentScreen extends StatefulWidget {
  final double amount;
  final String pickup;
  final String destination;
  final String riderName;
  final String riderPhone;
  final String typeVehicle;
  final double pickupLat;
  final double pickupLng;
  final String paymentMethod; // ✅ NEW: "cash" or "card"


  const PaymentScreen({
    super.key,
    required this.amount,
    required this.pickup,
    required this.destination,
    required this.riderName,
    required this.riderPhone,
    required this.typeVehicle,
    required this.pickupLat,
    required this.pickupLng,
     required this.paymentMethod, // ✅ NEW
  });

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  bool loading = false;

  // --- Start Stripe Checkout ---
  Future<void> _startCheckout() async {
    setState(() => loading = true);
    try {
       print("CALLING: $baseUrl/distance");
      final url = Uri.parse('$baseUrl/distance');
      print('widget.typeVehicle = ${widget.typeVehicle}');
      final response = await http.post(
        Uri.parse('$baseUrl/create-checkout-session'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': "test@casago.com",        // <--- ADD THIS
          'amount': widget.amount,
          'pickup': widget.pickup,
          'destination': widget.destination,
          'riderName': widget.riderName,
          'riderPhone': widget.riderPhone,
          'type_vehicle': widget.typeVehicle,
          'pickupLat': widget.pickupLat,
          'pickupLng': widget.pickupLng,
        }),
      );

      if (response.statusCode != 200) {
        throw Exception('Create session failed: ${response.body}');
      }

      final data = jsonDecode(response.body);
      final sessionUrl = data['url'];
      if (sessionUrl == null || sessionUrl is! String) {
        throw Exception('Invalid Stripe Checkout URL.');
      }

      // Navigate to WebView checkout
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PaymentWebViewScreen(
            checkoutUrl: sessionUrl,
            pickup: widget.pickup,
            destination: widget.destination,
            riderName: widget.riderName,
            riderPhone: widget.riderPhone,
            typeVehicle: widget.typeVehicle,
            amount: widget.amount,
            pickupLat: widget.pickupLat,
            pickupLng: widget.pickupLng,
          ),
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Payment failed: $e')),
      );
    } finally {
      setState(() => loading = false);
    }
  }
  ////////////add new function ///////////
   Future<void> _startCashFlow() async {
  setState(() => loading = true);
  try {
    // TODO Step 3: call your backend endpoint to create the ride and notify driver
    // Example endpoint name (we will set it in Step 3): /create-cash-ride
    final response = await http.post(
      Uri.parse('$baseUrl/create-cash-ride'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'amount': widget.amount,
        'pickup': widget.pickup,
        'destination': widget.destination,
        'riderName': widget.riderName,
        'riderPhone': widget.riderPhone,
        'type_vehicle': widget.typeVehicle,
        'pickupLat': widget.pickupLat,
        'pickupLng': widget.pickupLng,
        'payment_method': 'cash',
      }),
    );

    if (response.statusCode != 200) {
      throw Exception('Cash ride failed: ${response.body}');
    }

    // For now show success message. Step 3 will navigate to a confirmation screen.
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Cash ride created. Driver will be notified.')),
    );
  } catch (e) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Cash flow failed: $e')),
    );
  } finally {
    setState(() => loading = false);
  }
}

  ////////////////////////

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stripe Payment')),
      body: Center(
        child: loading
            ? const CircularProgressIndicator()
            : ElevatedButton(
                onPressed: _startCheckout,
                child: const Text('Pay with Stripe'),
              ),
      ),
    );
  }
}
