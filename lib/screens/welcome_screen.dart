// lib/screens/welcome_screen.dart
import 'package:flutter/material.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const String currentLang = 'fr'; // 'en' | 'fr'

    String t(String en, String fr) {
      return currentLang == 'fr' ? fr : en;
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(t('Welcome', 'Bienvenue')),
        centerTitle: true,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset(
                'assets/images/casago-logo.png',
                   width: 600,
                  fit: BoxFit.contain,
      ),
              const SizedBox(height: 24),
              Text(
                'CasaGo Express',
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 40),
              SizedBox(
                width: 260,
                child: ElevatedButton(
                  onPressed: () => Navigator.pushNamed(context, '/distance'),
                  child: Text(t('Rider', 'Passager')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}