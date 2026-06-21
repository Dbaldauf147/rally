#!/usr/bin/env ruby
# Injects a "ShareExtension" app-extension target into the Capacitor-generated
# Xcode project. /ios is regenerated on every CI build (npx cap add ios), so
# this runs after generation — the same idea as copying ci/ios/AppDelegate.swift
# over the generated one, but for a whole new target the .pbxproj must be edited.
#
# Run from the repo root, after `npx cap sync ios`:
#   ruby ci/ios/add-share-extension.rb
#
# Env (optional): EXT_BUNDLE_ID (default com.danbaldauf.rally.ShareExtension),
#                 DEVELOPMENT_TEAM (sets DEVELOPMENT_TEAM build setting).
require 'xcodeproj'
require 'fileutils'

PROJECT_PATH = 'ios/App/App.xcodeproj'
APP_TARGET   = 'App'
EXT_NAME     = 'ShareExtension'
EXT_BUNDLE   = ENV['EXT_BUNDLE_ID'] || 'com.danbaldauf.rally.ShareExtension'
TEAM         = ENV['DEVELOPMENT_TEAM']
SRC_DIR      = 'ci/ios/ShareExtension'                  # tracked sources
DEST_DIR     = "ios/App/#{EXT_NAME}"                    # inside the generated project

abort "Project not found at #{PROJECT_PATH} — run `npx cap add ios` first" unless Dir.exist?(PROJECT_PATH)

project  = Xcodeproj::Project.open(PROJECT_PATH)
app      = project.targets.find { |t| t.name == APP_TARGET } or abort "No '#{APP_TARGET}' target"

if project.targets.any? { |t| t.name == EXT_NAME }
  puts "#{EXT_NAME} target already present — skipping."
  exit 0
end

# Match the app's deployment target so the extension doesn't out-run the host.
deployment = app.build_configurations.map { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] }.compact.first || '14.0'

# Copy the tracked extension sources into the generated project tree.
FileUtils.mkdir_p(DEST_DIR)
FileUtils.cp("#{SRC_DIR}/ShareViewController.swift", "#{DEST_DIR}/ShareViewController.swift")
FileUtils.cp("#{SRC_DIR}/Info.plist",                "#{DEST_DIR}/Info.plist")

# New app-extension target (.appex).
ext = project.new_target(:app_extension, EXT_NAME, :ios, deployment)

# Group + source file in the project navigator, added to the compile phase.
group = project.main_group.new_group(EXT_NAME, EXT_NAME)
swift_ref = group.new_reference('ShareViewController.swift')
group.new_reference('Info.plist')
ext.source_build_phase.add_file_reference(swift_ref)

ext.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER']     = EXT_BUNDLE
  s['PRODUCT_NAME']                  = '$(TARGET_NAME)'
  s['INFOPLIST_FILE']                = "#{EXT_NAME}/Info.plist"
  s['GENERATE_INFOPLIST_FILE']       = 'NO'         # we ship our own Info.plist
  s['SWIFT_VERSION']                 = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET']    = deployment
  s['TARGETED_DEVICE_FAMILY']        = '1,2'
  s['CODE_SIGN_STYLE']               = 'Manual'
  s['SKIP_INSTALL']                  = 'YES'         # bundled inside the app, not installed standalone
  s['LD_RUNPATH_SEARCH_PATHS']       = '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
  s['DEVELOPMENT_TEAM'] = TEAM if TEAM
end

# Build the extension before the app, and embed it in the app bundle's PlugIns.
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Injected #{EXT_NAME} (#{EXT_BUNDLE}), deployment #{deployment}."
