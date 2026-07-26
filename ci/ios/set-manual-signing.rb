#!/usr/bin/env ruby
# Points each target at its signing identity and provisioning profile, so the
# archive can be signed rather than exported unsigned.
#
# Why this exists: the archive used to run with CODE_SIGNING_ALLOWED=NO and rely
# on `xcodebuild -exportArchive` to sign afterwards. That works for a plain app,
# but it silently drops entitlements — skipping code signing also skips the
# packaging phase that writes CODE_SIGN_ENTITLEMENTS into the app, so the export
# had nothing to preserve and synthesised a default entitlement set from the
# profile instead. The shipped binary then carried application-identifier and
# team-identifier but no aps-environment, and the device refused to register for
# push with "no valid 'aps-environment' entitlement string found".
#
# The profiles differ per target (app vs Share Extension have different bundle
# ids), so this can't be passed on the xcodebuild command line — those settings
# apply to every target at once. Hence per-target, here.
#
# Run from the repo root, after the profiles have been created so PROFILE_NAME /
# EXT_PROFILE_NAME are in the environment:
#   ruby ci/ios/set-manual-signing.rb
require 'xcodeproj'

PROJECT_PATH = 'ios/App/App.xcodeproj'
IDENTITY     = 'Apple Distribution'

abort "Project not found at #{PROJECT_PATH} — run `npx cap add ios` first" unless Dir.exist?(PROJECT_PATH)

profile     = ENV['PROFILE_NAME']
ext_profile = ENV['EXT_PROFILE_NAME']
team        = ENV['DEVELOPMENT_TEAM']
abort 'Missing PROFILE_NAME — run this after the signing assets are created' if profile.to_s.empty?

project = Xcodeproj::Project.open(PROJECT_PATH)

def apply(target, profile, team)
  target.build_configurations.each do |config|
    s = config.build_settings
    s['CODE_SIGN_STYLE'] = 'Manual'
    s['CODE_SIGN_IDENTITY'] = IDENTITY
    s['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = IDENTITY
    s['PROVISIONING_PROFILE_SPECIFIER'] = profile
    s['DEVELOPMENT_TEAM'] = team unless team.to_s.empty?
  end
end

app = project.targets.find { |t| t.name == 'App' } or abort "No 'App' target"
apply(app, profile, team)
puts "App -> #{IDENTITY} / #{profile}"

ext = project.targets.find { |t| t.name == 'ShareExtension' }
if ext && !ext_profile.to_s.empty?
  apply(ext, ext_profile, team)
  puts "ShareExtension -> #{IDENTITY} / #{ext_profile}"
end

project.save
