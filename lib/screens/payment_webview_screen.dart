// lib/screens/payment_webview_screen.dart
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'thank_you_screen.dart';

class PaymentWebViewScreen extends StatefulWidget {
  final String checkoutUrl;
  final String pickup;
  final String destination;
  final String riderName;
  final String riderPhone;
  final String typeVehicle;
  final double amount;
  final double pickupLat;
  final double pickupLng;

  const PaymentWebViewScreen({
    super.key,
    required this.checkoutUrl,
    required this.pickup,
    required this.destination,
    required this.riderName,
    required this.riderPhone,
    required this.typeVehicle,
    required this.amount,
    required this.pickupLat,
    required this.pickupLng,
  });

  @override
  State<PaymentWebViewScreen> createState() => _PaymentWebViewScreenState();
}

class _PaymentWebViewScreenState extends State<PaymentWebViewScreen> {
  InAppWebViewController? _controller;

  void _handleUrl(String url) {
    // Debug log
    debugPrint('WEBVIEW URL: $url');

    if (url.contains('success.html')) {
      _onPaymentSuccess();
    } else if (url.contains('cancel.html')) {
      Navigator.pop(context);
    }
  }

  void _onPaymentSuccess() {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) => ThankYouScreen(
          pickup: widget.pickup,
          destination: widget.destination,
          riderName: widget.riderName,
          riderPhone: widget.riderPhone,
          amount: widget.amount,
          typeVehicle: widget.typeVehicle,
          pickupLat: widget.pickupLat,
          pickupLng: widget.pickupLng,
        ),
      ),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Complete Payment')),
      body: InAppWebView(
        initialUrlRequest: URLRequest(url: WebUri(widget.checkoutUrl)),
        initialSettings: InAppWebViewSettings(
          javaScriptEnabled: true,
        ),
        onWebViewCreated: (controller) {
          _controller = controller;
        },
        onLoadStart: (controller, url) {
          final u = url?.toString() ?? '';
          _handleUrl(u);
        },
        onLoadStop: (controller, url) async {
          final u = url?.toString() ?? '';
          _handleUrl(u);
        },
      ),
    );
  }
}
