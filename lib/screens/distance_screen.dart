// lib/screens/distance_screen.dart
import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'payment_screen.dart';

const String baseUrl = "https://casago-api.azurewebsites.net";
final Uri url = Uri.parse("$baseUrl/distance");

enum PaymentMethod { cash, card }

class DistanceScreen extends StatefulWidget {
  const DistanceScreen({super.key});

  @override
  State<DistanceScreen> createState() => _DistanceScreenState();
}

class _DistanceScreenState extends State<DistanceScreen> {
  String selectedVehicleType = 'Sedan';
  PaymentMethod? _paymentMethod;
  bool _paymentMethodTouched = false;

  bool calculating = false;
  bool _loading = false;
  bool get _isFrenchUI => false;

  final _pickupController = TextEditingController();
  final _destinationController = TextEditingController();
  final _riderNameController = TextEditingController();
  final _riderPhoneController = TextEditingController();

  double? distanceKm;
  int? durationMin;
  double? fareAmount;

  double? pickupLat;
  double? pickupLng;
  double? destinationLat;
  double? destinationLng;

  static const List<String> vehicleOptions = [
    'Sedan',
    'SUV ',
    'MiniVan',
    'Van',
  ];

String vehicleForApi(String? value) {
  final v = (value ?? '').trim();
  debugPrint('[vehicleForApi] raw="$value" trimmed="$v"');

  switch (v) {
    case 'Sedan':
      debugPrint('[vehicleForApi] match=Sedan');
      return 'Sedan';

    case 'SUV':
    //case 'Petit-Honda':
    debugPrint('[vehicleForApi] match=SUV');
      return 'SUV';

    case 'MiniVan':
    //case 'Grand-Honda':
    debugPrint('[vehicleForApi] match=MiniVan');
      return 'MiniVan';

    case 'Van':
      debugPrint('[vehicleForApi] match=Van');
      return 'Van';

    default:
      debugPrint('[vehicleForApi] match=DEFAULT -> Sedan');
      return 'Sedan';
  }
}

  String vehicleImage(String vehicle) {
    switch (vehicle) {
      case 'Sedan':
        return 'assets/vehicles/small.png';
      case 'SUV':
        return 'assets/vehicles/suv.png';
      case 'MiniVan':
        return 'assets/vehicles/minivan.png';
      case 'Van':
        return 'assets/vehicles/van.png';
      default:
        return 'assets/vehicles/small.png';
    }
  }

  Future<void> _sendDriverRequest() async {
    final typeVehicle = vehicleForApi(selectedVehicleType);
    final body = {
      'riderName': _riderNameController.text.trim(),
      'riderPhone': _riderPhoneController.text.trim(),
      'pickup': _pickupController.text.trim(),
      'destination': _destinationController.text.trim(),
      'pickupLat': pickupLat,
      'pickupLng': pickupLng,
      'price': fareAmount,
      'etaMinutes': durationMin,
      'type_vehicle': typeVehicle,
    };

    print('[SEND] selectedVehicleType=$selectedVehicleType backendType=$typeVehicle');

    // your http.post(...) here
  }
//////////////////////////////////////////////////////
  @override
  void dispose() {
    _pickupController.dispose();
    _destinationController.dispose();
    _riderNameController.dispose();
    _riderPhoneController.dispose();
    super.dispose();
  }

  Future<void> _calculateDistance() async {
    if (calculating) return;

    setState(() => calculating = true);
    debugPrint('CALCUL: start');

    try {
      final requestedVehicle = vehicleForApi(selectedVehicleType);
debugPrint('[UI] selectedVehicleType=$selectedVehicleType');
debugPrint('CALCUL VEHICLE: $requestedVehicle');

final res = await http.post(
  Uri.parse('$baseUrl/distance'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'pickup': _pickupController.text.trim(),
    'destination': _destinationController.text.trim(),
    'requestedVehicle': requestedVehicle,
  }),
);

      debugPrint('CALCUL: status=${res.statusCode}');
      debugPrint('CALCUL: body=${res.body}');

      if (res.statusCode != 200) {
        throw Exception('HTTP ${res.statusCode}: ${res.body}');
      }

      final data = jsonDecode(res.body);

      setState(() {
        distanceKm = (data['distance_km'] as num?)?.toDouble();
        durationMin = (data['duration_min'] as num?)?.toInt();
        fareAmount = (data['fare'] as num?)?.toDouble();
        pickupLat = (data['pickup_lat'] as num?)?.toDouble();
        pickupLng = (data['pickup_lng'] as num?)?.toDouble();
      });
    } catch (e) {
      debugPrint('CALCUL: error=$e');

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erreur calcul: $e')),
      );
    } finally {
      if (mounted) {
        setState(() => calculating = false);
      }
      debugPrint('CALCUL: end');
    }
  }
Future<void> _startCashFlow() async {
  final url = Uri.parse('$baseUrl/notify-driver');

  if (fareAmount == null || fareAmount == 0) {
    print('ERROR: fareAmount is empty before sending cash request');
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Please calculate distance first')),
    );
    return;
  }

  print('CASH fareAmount before payload = $fareAmount');

  final payload = {
    'pickup': _pickupController.text.trim(),
    'destination': _destinationController.text.trim(),
    'riderName': _riderNameController.text.trim(),
    'riderPhone': _riderPhoneController.text.trim(),
    'pickupLat': pickupLat,
    'pickupLng': pickupLng,
    'amount': double.tryParse(fareAmount.toString()) ?? 0,
    'payment_method': 'cash',
    'type_vehicle': selectedVehicleType,
  };
    print('[SEND] selectedVehicleType=$selectedVehicleType '
        'pickupLat=$pickupLat pickupLng=$pickupLng');

    debugPrint('CALLING URL: $url');
print('PAYLOAD TO SEND: $payload');
    final res = await http.post(
      url,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );

    debugPrint('STATUS: ${res.statusCode}');
    debugPrint('RAW BODY: ${res.body}');

    if (res.statusCode != 200) {
      throw Exception('Cash flow failed');
    }

    Navigator.pushNamedAndRemoveUntil(
      context,
      '/welcome',
      (route) => false,
    );
  }

  bool get _isArabicUI {
    final code = Localizations.localeOf(context).languageCode.toLowerCase();
    return code.startsWith('ar');
  }

  String _t(String en, String fr) => _isFrenchUI ? fr : en;

  String get _paymentMethodValueForBackend {
    switch (_paymentMethod) {
      case PaymentMethod.cash:
        return "cash";
      case PaymentMethod.card:
        return "card";
      default:
        return "unknown";
    }
  }

  Widget _paymentMethodSection() {
  final title = _t("Choose payment method", "Choisissez le mode de paiement");
  final cashTitle = _t("Cash", "Espèces");
  final cardTitle = _t("Card (Debit/Credit)", "Carte (Débit/Crédit)");

  final cashHelp = _t(
    "You will pay the driver in cash at the end of the ride.",
    "Vous paierez le chauffeur en espèces à la fin de la course.",
  );
  final cardHelp = _t(
    "Payment is made online. The driver will automatically receive their share after the ride.",
    "Le paiement est effectué en ligne. Le chauffeur recevra sa part automatiquement après la course.",
  );

  final errorText = _t(
    "Please choose a payment method.",
    "Veuillez choisir une méthode de paiement.",
  );

    final isError = _paymentMethodTouched && _paymentMethod == null;

    Widget optionTile({
      required PaymentMethod value,
      required String title,
      required String subtitle,
      required IconData icon,
    }) {
      final selected = _paymentMethod == value;

      return InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          setState(() {
            _paymentMethod = value;
            _paymentMethodTouched = true;
          });
        },
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected
                  ? Theme.of(context).colorScheme.primary
                  : Colors.grey.shade300,
              width: selected ? 2 : 1,
            ),
            color: selected
                ? Theme.of(context).colorScheme.primary.withOpacity(0.06)
                : Colors.transparent,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: selected
                            ? Theme.of(context).colorScheme.primary
                            : null,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.25,
                        color: Colors.grey.shade700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Radio<PaymentMethod>(
                value: value,
                groupValue: _paymentMethod,
                onChanged: (v) {
                  setState(() {
                    _paymentMethod = v;
                    _paymentMethodTouched = true;
                  });
                },
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 14),
        Text(
          title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 10),
        optionTile(
          value: PaymentMethod.cash,
          title: cashTitle,
          subtitle: cashHelp,
          icon: Icons.payments_outlined,
        ),
        const SizedBox(height: 10),
        optionTile(
          value: PaymentMethod.card,
          title: cardTitle,
          subtitle: cardHelp,
          icon: Icons.credit_card,
        ),
        if (isError) ...[
          const SizedBox(height: 8),
          Text(
            errorText,
            style: const TextStyle(
              color: Colors.red,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _onProceedPressed() async {
    setState(() => _paymentMethodTouched = true);

    if (_paymentMethod == null) return;

    if (_paymentMethod == PaymentMethod.card) {
      _goToPayment();
      return;
    }

    setState(() => _loading = true);
    try {
      await _startCashFlow();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _goToPayment() {
    if (fareAmount == null) return;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PaymentScreen(
          amount: fareAmount!,
          pickup: _pickupController.text.trim(),
          destination: _destinationController.text.trim(),
          riderName: _riderNameController.text.trim(),
          riderPhone: _riderPhoneController.text.trim(),
          pickupLat: pickupLat ?? 0.0,
          pickupLng: pickupLng ?? 0.0,
          typeVehicle: selectedVehicleType,
          paymentMethod: _paymentMethodValueForBackend,
        ),
      ),
    );
  }

  bool get _canPay =>
      fareAmount != null &&
      _pickupController.text.trim().isNotEmpty &&
      _destinationController.text.trim().isNotEmpty &&
      _riderNameController.text.trim().isNotEmpty &&
      _riderPhoneController.text.trim().isNotEmpty &&
      _paymentMethod != null;

  Widget _buildUberLikeField({
    required IconData icon,
    required String hint,
    required TextEditingController controller,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.grey, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: controller,
              keyboardType: keyboardType,
              style: const TextStyle(fontSize: 17),
              decoration: InputDecoration(
                hintText: hint,
                border: InputBorder.none,
                hintStyle: TextStyle(
                  color: Colors.grey.shade400,
                  fontSize: 17,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUberAddressBlock() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: const BoxDecoration(
                  color: Colors.green,
                  shape: BoxShape.circle,
                ),
              ),
              Container(
                width: 1.5,
                height: 30,
                color: Colors.grey,
              ),
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: Colors.black,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              children: [
                TextField(
                  controller: _pickupController,
                  style: const TextStyle(fontSize: 17),
                  decoration: InputDecoration(
                    hintText: 'Pickup address',
                    border: InputBorder.none,
                    hintStyle: TextStyle(
                      color: Colors.grey.shade400,
                      fontSize: 17,
                    ),
                  ),
                ),
                Divider(height: 1, color: Colors.grey.shade300),
                TextField(
                  controller: _destinationController,
                  style: const TextStyle(fontSize: 17),
                  decoration: InputDecoration(
                    hintText: 'Delivery adress livraison',
                    border: InputBorder.none,
                    hintStyle: TextStyle(
                      color: Colors.grey.shade400,
                      fontSize: 17,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
Widget _buildCasagoEntrySection() {
  return Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
     // Center(
   //     child: Image.asset(
    //      'assets/images/casago-logo.png',
    //      width: 320,
    //      fit: BoxFit.contain,
    //    ),
     // ),
    //  const SizedBox(height: 24),

      _buildUberLikeField(
        icon: Icons.person_outline,
        hint: 'Nom',
        controller: _riderNameController,
      ),
      const SizedBox(height: 12),

      _buildUberLikeField(
        icon: Icons.phone_outlined,
        hint: 'Phone (...)',
        controller: _riderPhoneController,
        keyboardType: TextInputType.phone,
      ),
      const SizedBox(height: 12),

      _buildUberAddressBlock(),
      const SizedBox(height: 10),

      Align(
        alignment: Alignment.center,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.orange.withOpacity(0.16),
            borderRadius: BorderRadius.circular(20),
          ),
          child: const Text(
            'Based on your needs  Select  Selon vos besoins',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Colors.black,
            ),
          ),
        ),
      ),
    ],
  );
}
////////////////////////////////AQDD  QQQQQQQQQQQQQQQQQQQQQQQQQQ////////////////////////
String _vehicleSubtitle(String vehicle) {
  debugPrint('SUBTITLE vehicle="$vehicle"');

  switch (vehicle.trim()) {
    case 'Sedan':
      return 'Small parcels/boxes • Petits colis/boîtes';
    case 'SUV':
      return 'Medium boxes • Charges moyennes';
    case 'MiniVan':
      return 'Big volume • Charges volumineuses';
    case 'Van':
      return 'Best choice, much space • Meilleur choix, grand volume';
    default:
      return '';
  }
}
Widget _buildVehicleRow(String vehicle, {required bool isLast}) {
  String normalizeVehicleType(String raw) {
    final v = raw.trim();

    if (v.contains('MiniVan')) return 'MiniVan';
    if (v.contains('SUV')) return 'SUV';
    if (v.contains('Sedan')) return 'Sedan';
    if (v.contains('Van')) return 'Van';

    return v;
  }

  final normalizedVehicle = normalizeVehicleType(vehicle);
  final selected = selectedVehicleType == normalizedVehicle;

  return InkWell(
    onTap: () {
      setState(() {
        selectedVehicleType = normalizedVehicle;
        print('[UI] selectedVehicleType=$selectedVehicleType');
      });
    },
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      child: Row(
        children: [
          Container(
            width: 64,
            height: 44,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              color: Colors.grey.shade100,
            ),
            clipBehavior: Clip.antiAlias,
            child: Image.asset(
              vehicleImage(vehicle),
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  vehicle,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: Colors.black87,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _vehicleSubtitle(vehicle),
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey.shade600,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Icon(
            selected ? Icons.radio_button_checked : Icons.radio_button_off,
            color: selected ? Colors.black : Colors.grey.shade400,
            size: 24,
          ),
        ],
      ),
    ),
  );
}
Widget _buildUberLikeVehicleSection() {
  return Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      
      Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [
            BoxShadow(
              color: Color(0x14000000),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          children: List.generate(vehicleOptions.length, (index) {
            final vehicle = vehicleOptions[index];
            final isLast = index == vehicleOptions.length - 1;

            return Column(
              children: [
                _buildVehicleRow(vehicle, isLast: isLast),
                if (!isLast)
                  Divider(
                    height: 1,
                    thickness: 1,
                    color: Colors.grey.shade200,
                    indent: 90,
                    endIndent: 14,
                  ),
              ],
            );
          }),
        ),
      ),
    ],
  );
}

//////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAQQQQQQQQQQQQQQQQQQ/////
 @override
Widget build(BuildContext context) {
  return Scaffold(
    backgroundColor: const Color(0xFFF6F6F6),
    body: SingleChildScrollView(
  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Align(
        alignment: Alignment.topCenter,
  child: SizedBox(
  height: 70,
  width: 320,
  child: Image.asset(
    'assets/images/casago-logo.png',
    fit: BoxFit.cover,
  ),
),
),
const SizedBox(height: 4),

      const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'Welcome to Delivery',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
            ),
          ),
          SizedBox(width: 14),
          Text(
            'Bienvenue aux Livraisons',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),

      _buildCasagoEntrySection(),
    // _buildCasagoEntrySection(),

    /////////////////////////////////////
    _buildUberLikeVehicleSection(),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: calculating ? null : _calculateDistance,
              child: calculating
                  ? const CircularProgressIndicator(color: Colors.white)
                  : const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Montant/Fare',
                        style: TextStyle(color: Colors.blue),
                      ),
                    ),
            ),
            if (fareAmount != null) ...[
              const SizedBox(height: 20),
              Card(
                margin: const EdgeInsets.symmetric(horizontal: 8),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Distance: ${distanceKm?.toStringAsFixed(2)} km'),
                      Text('Temps/Duration: ${durationMin ?? '-'} min'),
                      Text('Prix/Price: ${fareAmount?.toStringAsFixed(2)} CAD'),
                    ],
                  ),
                ),
              ),
              _paymentMethodSection(),
            ],
            const SizedBox(height: 20),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              ),
                ElevatedButton(
              onPressed: !_canPay
                  ? null
                  : () async {
                      if (_paymentMethodValueForBackend == 'cash') {
                        setState(() => _loading = true);
                        try {
                          await _startCashFlow();
                        } finally {
                          if (mounted) setState(() => _loading = false);
                        }
                      } else {
                        _onProceedPressed();
                      }
                    },
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _t("Confirm", "Accepter"),
                  style: const TextStyle(color: Colors.blue),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}