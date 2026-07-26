#!/usr/bin/env ruby
# Gives the generated app target the Push Notifications entitlement. /ios is
# regenerated on every CI build (npx cap add ios), so — like the AppDelegate copy
# and the Share Extension injection — this has to be reapplied after generation
# rather than checked in.
#
# In Xcode this is the "+ Capability -> Push Notifications" button, which does two
# things: writes an .entitlements file containing aps-environment, and points the
# target's CODE_SIGN_ENTITLEMENTS at it. That's all this does, headlessly.
#
# The matching half lives in ci/create-signing-assets.mjs, which turns the
# capability on for the App ID so the provisioning profile carries it too. Both
# are required: an entitlement the profile doesn't authorise fails to sign.
#
# Run from the repo root, after `npx cap sync ios`:
#   ruby ci/ios/add-push-entitlement.rb
require 'xcodeproj'
require 'fileutils'

PROJECT_PATH = 'ios/App/App.xcodeproj'
APP_TARGET   = 'App'
SRC          = 'ci/ios/App.entitlements'            # tracked source of truth
DEST         = 'ios/App/App/App.entitlements'       # inside the generated project
SETTING      = 'App/App.entitlements'               # as xcodebuild resolves it (relative to ios/App)

abort "Project not found at #{PROJECT_PATH} — run `npx cap add ios` first" unless Dir.exist?(PROJECT_PATH)
abort "Missing #{SRC}" unless File.exist?(SRC)

FileUtils.cp(SRC, DEST)

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == APP_TARGET } or abort "No '#{APP_TARGET}' target"

# Show it in the navigator alongside Info.plist, so the file isn't invisible if
# anyone ever opens the generated project.
app_group = project.main_group.find_subpath('App', false)
if app_group && app_group.files.none? { |f| f.path == 'App.entitlements' }
  app_group.new_reference('App.entitlements')
end

app.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = SETTING
end

project.save
puts "Enabled Push Notifications entitlement on #{APP_TARGET} (#{SETTING})."
