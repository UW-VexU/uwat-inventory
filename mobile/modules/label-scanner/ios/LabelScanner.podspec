Pod::Spec.new do |s|
  s.name           = 'LabelScanner'
  s.version        = '1.0.0'
  s.summary        = 'Reads part bag labels with Apple Vision'
  s.author         = 'UW VEX U'
  s.homepage       = 'https://github.com/UW-VexU'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
