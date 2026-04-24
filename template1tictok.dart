import 'package:flutter/material.dart';

void main() {
  runApp(const TikTokBusinessTemplateApp());
}

class TikTokBusinessTemplateApp extends StatelessWidget {
  const TikTokBusinessTemplateApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'TikTok Business Template',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
        fontFamily: 'Arial',
      ),
      home: const TikTokTemplateEditor(),
    );
  }
}

class TikTokTemplateEditor extends StatefulWidget {
  const TikTokTemplateEditor({super.key});

  @override
  State<TikTokTemplateEditor> createState() => _TikTokTemplateEditorState();
}

class _TikTokTemplateEditorState extends State<TikTokTemplateEditor> {
  final dayController = TextEditingController(text: '1');
  final budgetController = TextEditingController(text: '50');
  final hookController = TextEditingController(
    text: 'What business can you start with just \$50?',
  );
  final businessTitleController = TextEditingController(
    text: 'Home Snack Delivery',
  );
  final step1Controller = TextEditingController(text: 'Buy simple ingredients');
  final step2Controller = TextEditingController(text: 'Post in local groups');
  final step3Controller = TextEditingController(text: 'Deliver nearby');
  final profitController = TextEditingController(text: 'Profit: \$20–\$50 / Day');
  final ctaController = TextEditingController(text: 'Follow for Day 2');

  @override
  void dispose() {
    dayController.dispose();
    budgetController.dispose();
    hookController.dispose();
    businessTitleController.dispose();
    step1Controller.dispose();
    step2Controller.dispose();
    step3Controller.dispose();
    profitController.dispose();
    ctaController.dispose();
    super.dispose();
  }

  void _refresh() => setState(() {});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F4F6),
      appBar: AppBar(
        title: const Text('TikTok Business Template'),
        centerTitle: true,
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final isWide = constraints.maxWidth > 980;

          return Padding(
            padding: const EdgeInsets.all(16),
            child: isWide
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 4,
                        child: _EditorPanel(
                          dayController: dayController,
                          budgetController: budgetController,
                          hookController: hookController,
                          businessTitleController: businessTitleController,
                          step1Controller: step1Controller,
                          step2Controller: step2Controller,
                          step3Controller: step3Controller,
                          profitController: profitController,
                          ctaController: ctaController,
                          onChanged: _refresh,
                        ),
                      ),
                      const SizedBox(width: 20),
                      Expanded(
                        flex: 3,
                        child: _PreviewPanel(
                          day: dayController.text,
                          budget: budgetController.text,
                          hook: hookController.text,
                          businessTitle: businessTitleController.text,
                          step1: step1Controller.text,
                          step2: step2Controller.text,
                          step3: step3Controller.text,
                          profit: profitController.text,
                          cta: ctaController.text,
                        ),
                      ),
                    ],
                  )
                : ListView(
                    children: [
                      _EditorPanel(
                        dayController: dayController,
                        budgetController: budgetController,
                        hookController: hookController,
                        businessTitleController: businessTitleController,
                        step1Controller: step1Controller,
                        step2Controller: step2Controller,
                        step3Controller: step3Controller,
                        profitController: profitController,
                        ctaController: ctaController,
                        onChanged: _refresh,
                      ),
                      const SizedBox(height: 20),
                      _PreviewPanel(
                        day: dayController.text,
                        budget: budgetController.text,
                        hook: hookController.text,
                        businessTitle: businessTitleController.text,
                        step1: step1Controller.text,
                        step2: step2Controller.text,
                        step3: step3Controller.text,
                        profit: profitController.text,
                        cta: ctaController.text,
                      ),
                    ],
                  ),
          );
        },
      ),
    );
  }
}

class _EditorPanel extends StatelessWidget {
  const _EditorPanel({
    required this.dayController,
    required this.budgetController,
    required this.hookController,
    required this.businessTitleController,
    required this.step1Controller,
    required this.step2Controller,
    required this.step3Controller,
    required this.profitController,
    required this.ctaController,
    required this.onChanged,
  });

  final TextEditingController dayController;
  final TextEditingController budgetController;
  final TextEditingController hookController;
  final TextEditingController businessTitleController;
  final TextEditingController step1Controller;
  final TextEditingController step2Controller;
  final TextEditingController step3Controller;
  final TextEditingController profitController;
  final TextEditingController ctaController;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Daily Content Editor',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Update the fields, then take a screenshot of the preview and post it on TikTok.',
              style: TextStyle(fontSize: 14, color: Colors.black54),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: _InputField(
                    label: 'Day',
                    controller: dayController,
                    onChanged: (_) => onChanged(),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _InputField(
                    label: 'Budget',
                    controller: budgetController,
                    onChanged: (_) => onChanged(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'Hook',
              controller: hookController,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'Business Title',
              controller: businessTitleController,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'Step 1',
              controller: step1Controller,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'Step 2',
              controller: step2Controller,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'Step 3',
              controller: step3Controller,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'Profit Line',
              controller: profitController,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 12),
            _InputField(
              label: 'CTA',
              controller: ctaController,
              onChanged: (_) => onChanged(),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Text(
                'Recommended daily workflow:\n'
                '1. Change day and budget\n'
                '2. Update business idea and 3 steps\n'
                '3. Check the preview\n'
                '4. Take a clean screenshot of the preview only\n'
                '5. Add voice or music before posting',
                style: TextStyle(fontSize: 14, height: 1.5),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InputField extends StatelessWidget {
  const _InputField({
    required this.label,
    required this.controller,
    required this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        filled: true,
        fillColor: Colors.white,
      ),
    );
  }
}

class _PreviewPanel extends StatelessWidget {
  const _PreviewPanel({
    required this.day,
    required this.budget,
    required this.hook,
    required this.businessTitle,
    required this.step1,
    required this.step2,
    required this.step3,
    required this.profit,
    required this.cta,
  });

  final String day;
  final String budget;
  final String hook;
  final String businessTitle;
  final String step1;
  final String step2;
  final String step3;
  final String profit;
  final String cta;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'TikTok Preview (9:16)',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        Center(
          child: AspectRatio(
            aspectRatio: 9 / 16,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 380),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(28),
                boxShadow: const [
                  BoxShadow(
                    color: Colors.black12,
                    blurRadius: 18,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _TopQuestionCard(hook: hook),
                    const SizedBox(height: 16),
                    _BlueTitleBar(day: day, budget: budget),
                    const SizedBox(height: 18),
                    Text(
                      businessTitle,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        color: Colors.black,
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Divider(height: 1),
                    const SizedBox(height: 14),
                    _StepRow(number: '1', text: step1),
                    const SizedBox(height: 14),
                    const Divider(height: 1),
                    const SizedBox(height: 14),
                    _StepRow(number: '2', text: step2),
                    const SizedBox(height: 14),
                    const Divider(height: 1),
                    const SizedBox(height: 14),
                    _StepRow(number: '3', text: step3),
                    const SizedBox(height: 22),
                    const Divider(height: 1),
                    const SizedBox(height: 20),
                    Text(
                      profit,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      decoration: BoxDecoration(
                        color: Colors.black,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        cta,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _TopQuestionCard extends StatelessWidget {
  const _TopQuestionCard({required this.hook});

  final String hook;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Text(
        hook,
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w900,
          height: 1.15,
        ),
      ),
    );
  }
}

class _BlueTitleBar extends StatelessWidget {
  const _BlueTitleBar({required this.day, required this.budget});

  final String day;
  final String budget;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: Colors.blue,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        'DAY $day — \$$budget BUSINESS',
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 25,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.number, required this.text});

  final String number;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$number.',
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w900,
            color: Colors.blue,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              height: 1.2,
            ),
          ),
        ),
      ],
    );
  }
}
