import 'package:flutter/material.dart';
import 'screens/driver_heartbeat_screen.dart';
import 'screens/distance_screen.dart';
import 'screens/payment_screen.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(); // loads from assets (.env)
  runApp(const MyApp());
}


class AppRoutes {
  static const welcome = '/welcome';
  static const distance = '/distance';
  static const payment = '/payment';
  static const driverHeartbeat = '/driver-heartbeat';
}

class AppColors {
  static const Color casagoGreen = Color(0xFF0FA958);
  static const Color casagoRed = Color(0xFFE53935);
  static const Color casagoBlack = Color(0xFF111111);
  static const Color lightBorder = Color(0xFFE9E9E9);
  static const Color lightFill = Color(0xFFF3F3F3);
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Casago',
      debugShowCheckedModeBanner: false,
      initialRoute: AppRoutes.welcome,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: Colors.white,
      ),

      routes: {
        AppRoutes.welcome: (_) => const WelcomeScreenDesigned(),
        AppRoutes.distance: (_) => const DistanceScreen(),
        AppRoutes.driverHeartbeat: (_) => const DriverHeartbeatScreen(),
      },

      onGenerateRoute: (settings) {
        if (settings.name == AppRoutes.payment) {
          final args = settings.arguments as Map<String, dynamic>?;
          if (args == null) {
            throw Exception(
              'Missing arguments for /payment. '
              'Use Navigator.pushNamed(context, "/payment", arguments: {...});',
            );
          }

          double d(String k) {
            final v = args[k];
            if (v == null) throw Exception('Missing "$k" for /payment');
            if (v is num) return v.toDouble();
            final parsed = double.tryParse(v.toString());
            if (parsed == null) throw Exception('Invalid double for "$k": $v');
            return parsed;
          }

          String s(String k) {
            final v = args[k];
            if (v == null) throw Exception('Missing "$k" for /payment');
            return v.toString();
          }

          return MaterialPageRoute(
            settings: settings,
            builder: (_) => PaymentScreen(
              amount: d('amount'),
              pickup: s('pickup'),
              destination: s('destination'),
              riderName: s('riderName'),
              riderPhone: s('riderPhone'),
              typeVehicle: s('typeVehicle'),
              pickupLat: d('pickupLat'),
              pickupLng: d('pickupLng'),
              paymentMethod: s('paymentMethod'),
            ),
          );
        }
        return null;
      },
    );
  }
}

/* ===================== UBER-INSPIRED WELCOME ===================== */
class WelcomeScreenDesigned extends StatefulWidget {
  const WelcomeScreenDesigned({super.key});

  @override
  State<WelcomeScreenDesigned> createState() => _WelcomeScreenDesignedState();
}

class _WelcomeScreenDesignedState extends State<WelcomeScreenDesigned>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _scale = Tween<double>(begin: 0.96, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeOut,
      ),
    );

    _controller.forward();

    Future.delayed(const Duration(seconds: 3), () {
      if (!mounted) return;
      Navigator.pushReplacementNamed(context, AppRoutes.distance);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: ScaleTransition(
          scale: _scale,
          child: const _CasaGoWordmarkCentered(),
        ),
      ),
    );
  }
}

class _CasaGoWordmarkCentered extends StatelessWidget {
  const _CasaGoWordmarkCentered();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Main CasaGo (bigger)
        RichText(
          text: const TextSpan(
            style: TextStyle(
              fontSize: 66, // ~1.5x bigger than 44
              fontWeight: FontWeight.w900,
              letterSpacing: -1,
            ),
            children: [
              TextSpan(
                text: 'Casa',
                style: TextStyle(color: AppColors.casagoGreen),
              ),
              TextSpan(
                text: 'Go',
                style: TextStyle(color: AppColors.casagoRed),
              ),
            ],
          ),
        ),

        const SizedBox(height: 12),

        // Subtitle
        const Text(
          'Livraisons -  Delivery',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Colors.black54,
          ),
        ),
      ],
    );
  }
}


class _CasaGoWordmark extends StatelessWidget {
  const _CasaGoWordmark();

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: const TextSpan(
        style: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w900,
          letterSpacing: -0.3,
        ),
        children: [
          TextSpan(text: 'Casa', style: TextStyle(color: AppColors.casagoGreen)),
          TextSpan(text: 'Go', style: TextStyle(color: AppColors.casagoRed)),
        ],
      ),
    );
  }
}

class _TopPillButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _TopPillButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.lightFill,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.lightBorder),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: AppColors.casagoBlack),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: AppColors.casagoBlack,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FakeSearchCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData leadingIcon;
  final Color leadingColor;
  final VoidCallback onTap;

  const _FakeSearchCard({
    required this.title,
    required this.subtitle,
    required this.leadingIcon,
    required this.leadingColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.lightBorder),
        ),
        child: Row(
          children: [
            Container(
              height: 42,
              width: 42,
              decoration: BoxDecoration(
                color: leadingColor.withOpacity(0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(leadingIcon, color: leadingColor),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: AppColors.casagoBlack,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: Colors.black.withOpacity(0.55),
                      fontSize: 13,
                      height: 1.15,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            const Icon(Icons.chevron_right_rounded, size: 26),
          ],
        ),
      ),
    );
  }
}

class _QuickChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickChip({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        height: 52,
        decoration: BoxDecoration(
          color: AppColors.lightFill,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.lightBorder),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        child: Row(
          children: [
            Icon(icon, color: AppColors.casagoBlack),
            const SizedBox(width: 10),
            Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                color: AppColors.casagoBlack,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
