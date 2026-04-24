workflows:
  ios-release:
    name: iOS Release
    max_build_duration: 120
    instance_type: mac_mini_m2

    environment:
      flutter: stable
      xcode: latest
      cocoapods: default

    scripts:
      - name: Get Flutter packages
        script: flutter pub get

      - name: Build iOS IPA
        script: flutter build ipa --release

    artifacts:
      - build/ios/ipa/*.ipa