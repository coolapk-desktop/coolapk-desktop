import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const androidDir = join(root, 'src-tauri', 'gen', 'android');
const androidIconSourceDir = join(root, 'src-tauri', 'android', 'res');
const androidResourceDir = join(androidDir, 'app', 'src', 'main', 'res');
const gradleProperties = join(androidDir, 'gradle.properties');
const appBuildGradle = join(androidDir, 'app', 'build.gradle.kts');
const androidManifest = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const androidFilePaths = join(androidDir, 'app', 'src', 'main', 'res', 'xml', 'file_paths.xml');
const androidActivityDir = join(androidDir, 'app', 'src', 'main', 'java', 'com', 'coolapk', 'desktop');
const keystoreProperties = join(androidDir, 'keystore.properties');
const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const initOnly = process.argv.includes('--init-only');
const fastRelease = process.argv.includes('--fast-release');
const forwardedArgs = process.argv.slice(2).filter((arg) => !['--init-only', '--fast-release'].includes(arg));
if (fastRelease && forwardedArgs.includes('--debug')) throw new Error('--fast-release 不能与 --debug 同时使用');
if (fastRelease) {
  // 仅用于本地优化构建；正式发布仍使用 Cargo.toml 的完整 LTO 配置。
  process.env.CARGO_PROFILE_RELEASE_LTO = 'thin';
  process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '16';
}

function latestDirectory(directory) {
  if (!existsSync(directory)) return '';
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1) || '';
}

function configureWindowsEnvironment() {
  if (process.platform !== 'win32') return;

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const sdk = process.env.ANDROID_HOME || join(localAppData, 'Android', 'Sdk');
  const bundledJdkRoot = join(programFiles, 'Android', 'openjdk');
  const bundledJdk = latestDirectory(bundledJdkRoot);
  const javaHome = process.env.JAVA_HOME || (bundledJdk ? join(bundledJdkRoot, bundledJdk) : '');
  const ndkVersion = latestDirectory(join(sdk, 'ndk'));
  const ndkHome = process.env.NDK_HOME || (ndkVersion ? join(sdk, 'ndk', ndkVersion) : '');

  if (!javaHome || !existsSync(join(javaHome, 'bin', 'javac.exe'))) {
    throw new Error('未找到 Android JDK，请安装 Android Studio/JDK 17+，并设置 JAVA_HOME。');
  }
  if (!existsSync(sdk)) {
    throw new Error('未找到 Android SDK，请安装 Android SDK，并设置 ANDROID_HOME。');
  }
  if (!ndkHome || !existsSync(ndkHome)) {
    throw new Error('未找到 Android NDK，请通过 SDK Manager 安装 NDK (Side by side)。');
  }

  process.env.JAVA_HOME = javaHome;
  process.env.ANDROID_HOME = sdk;
  process.env.NDK_HOME = ndkHome;
  process.env.CARGO_TARGET_DIR ||= join(localAppData, 'coolapk-desktop', 'android-target');
  process.env.Path = [
    join(javaHome, 'bin'),
    join(sdk, 'platform-tools'),
    join(sdk, 'cmdline-tools', 'latest', 'bin'),
    process.env.Path || '',
  ].join(';');
}

function runTauri(args) {
  const result = spawnSync(process.execPath, [tauriCli, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copyAndroidResources(sourceDir, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);
    if (entry.isDirectory()) copyAndroidResources(sourcePath, destinationPath);
    else copyFileSync(sourcePath, destinationPath);
  }
}

function setAndroidApplicationAttribute(manifest, attribute, value) {
  const applicationTag = manifest.match(/<application\b[^>]*>/)?.[0];
  if (!applicationTag) throw new Error('AndroidManifest.xml 缺少 application 节点');
  const attributePattern = new RegExp(`\\s${attribute}="[^"]*"`);
  const replacement = ` ${attribute}="${value}"`;
  const updatedTag = attributePattern.test(applicationTag)
    ? applicationTag.replace(attributePattern, replacement)
    : applicationTag.replace(/>$/, `${replacement}>`);
  return manifest.replace(applicationTag, updatedTag);
}

function ensureAndroidProject() {
  if (!existsSync(join(androidDir, 'gradlew.bat')) && !existsSync(join(androidDir, 'gradlew'))) {
    runTauri(['android', 'init', '--ci']);
  }

  // Tauri 生成的 Android 工程是临时目录；每次构建都同步仓库内的启动器图标资源。
  copyAndroidResources(androidIconSourceDir, androidResourceDir);

  const pathCheckSetting = 'android.overridePathCheck=true';
  const contents = existsSync(gradleProperties) ? readFileSync(gradleProperties, 'utf8') : '';
  if (!contents.includes(pathCheckSetting)) {
    appendFileSync(gradleProperties, `\n${pathCheckSetting}\n`, 'utf8');
  }
  // 中文仓库路径需要此兼容开关；仅排除它和提示配置本身的实验选项提示。
  const knownOption = 'android.suppressUnsupportedOptionWarnings=android.overridePathCheck,android.suppressUnsupportedOptionWarnings';
  const currentProperties = readFileSync(gradleProperties, 'utf8');
  writeFileSync(gradleProperties, /^android\.suppressUnsupportedOptionWarnings=.*$/m.test(currentProperties)
    ? currentProperties.replace(/^android\.suppressUnsupportedOptionWarnings=.*$/m, knownOption)
    : `${currentProperties}\n${knownOption}\n`, 'utf8');

  const projectBuildPath = join(androidDir, 'build.gradle.kts');
  let projectBuild = readFileSync(projectBuildPath, 'utf8')
    .replace(/org\.jetbrains\.kotlin:kotlin-gradle-plugin:[\d.]+/g, 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21');
  if (!projectBuild.includes('// coolapk-jvm-target')) {
    projectBuild += `\n// coolapk-jvm-target\nallprojects {\n    afterEvaluate {\n        extensions.findByType<com.android.build.gradle.BaseExtension>()?.compileOptions?.apply {\n            sourceCompatibility = JavaVersion.VERSION_11\n            targetCompatibility = JavaVersion.VERSION_11\n        }\n        tasks.withType<JavaCompile>().configureEach {\n            sourceCompatibility = "11"\n            targetCompatibility = "11"\n        }\n        tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {\n            compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)\n            // Windows 跨盘依赖无法生成相对路径的增量缓存；Gradle 仍会复用未变化任务。\n            if (project.projectDir.toPath().root != rootProject.projectDir.toPath().root) incremental = false\n        }\n    }\n}\n`;
  }
  writeFileSync(projectBuildPath, projectBuild, 'utf8');

  const buildTaskPath = join(androidDir, 'buildSrc', 'src', 'main', 'java', 'com', 'coolapk', 'desktop', 'kotlin', 'BuildTask.kt');
  let buildTask = readFileSync(buildTaskPath, 'utf8');
  if (buildTask.includes('project.exec {')) {
    buildTask = `import javax.inject.Inject\nimport org.gradle.process.ExecOperations\n${buildTask}`
      .replace('open class BuildTask : DefaultTask()', 'open class BuildTask @Inject constructor(private val execOperations: ExecOperations) : DefaultTask()')
      .replace('project.exec {', 'execOperations.exec {');
  }
  // TaskAction 执行阶段不再访问 Project；路径在配置阶段保存，日志使用任务自身的 logger。
  if (!buildTask.includes('val cliProjectDir: File')) {
    buildTask = buildTask.replace('    @Input', '    @get:org.gradle.api.tasks.Internal\n    val cliProjectDir: File = project.projectDir\n\n    @Input');
  }
  buildTask = buildTask.replaceAll('File(project.projectDir, rootDirRel)', 'File(cliProjectDir, rootDirRel)')
    .replaceAll('project.logger.', 'logger.');
  writeFileSync(buildTaskPath, buildTask, 'utf8');

  const signingMarker = '// coolapk-android-release-signing';
  let buildGradle = readFileSync(appBuildGradle, 'utf8');
  buildGradle = buildGradle.replace(/    kotlinOptions\s*\{\s*jvmTarget = "1\.8"\s*\}/, '');
  if (!buildGradle.includes(signingMarker)) {
    buildGradle = buildGradle.replace(
      '\nandroid {',
      `\n${signingMarker}\nval signingPropertiesFile = rootProject.file("keystore.properties")\nval signingProperties = Properties().apply {\n    if (signingPropertiesFile.exists()) {\n        signingPropertiesFile.inputStream().use { load(it) }\n    }\n}\n\nandroid {`,
    );
    buildGradle = buildGradle.replace(
      '    buildTypes {',
      `    if (signingPropertiesFile.exists()) {\n        signingConfigs {\n            create("release") {\n                keyAlias = signingProperties.getProperty("keyAlias")\n                keyPassword = signingProperties.getProperty("keyPassword")\n                storeFile = rootProject.file(signingProperties.getProperty("storeFile"))\n                storePassword = signingProperties.getProperty("storePassword")\n            }\n        }\n    }\n    buildTypes {`,
    );
    buildGradle = buildGradle.replace(
      '        getByName("release") {',
      `        getByName("release") {\n            if (signingPropertiesFile.exists()) {\n                signingConfig = signingConfigs.getByName("release")\n            }`,
    );
  }
  // Gradle 在 minSdk >= 24 时可能只生成 v2 签名；同时启用 v1 兼容旧版文件管理器的签名检查。
  const signingStorePassword = 'storePassword = signingProperties.getProperty("storePassword")';
  if (!buildGradle.includes('enableV1Signing = true')) {
    if (!buildGradle.includes(signingStorePassword)) {
      throw new Error('Android Release 签名配置缺少 storePassword，无法启用 v1/v2 签名');
    }
    buildGradle = buildGradle.replace(
      signingStorePassword,
      `${signingStorePassword}\n                enableV1Signing = true\n                enableV2Signing = true`,
    );
  }
  const sizeOptimizationMarker = '// coolapk-android-size-optimization';
  if (!buildGradle.includes(sizeOptimizationMarker)) {
    buildGradle = buildGradle.replace(
      '    buildTypes {',
      `    ${sizeOptimizationMarker}\n    androidResources {\n        localeFilters += listOf("zh", "zh-rCN", "zh-rHK", "zh-rTW", "en")\n    }\n    packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }\n    buildTypes {`,
    );
  }
  // Tauri 模板在 debug buildType 内调用的 packaging 实际作用域为全局 android.packaging，
  // 若不限定仅 Debug 任务生效，会导致 Release 构建也跳过 .so 符号表剥离。
  const unconditionalKeepSymbols = [
    '            packaging {',
    '                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")',
    '                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")',
    '                jniLibs.keepDebugSymbols.add("*/x86/*.so")',
    '                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")',
    '            }',
  ].join('\n');
  const debugOnlyKeepSymbols = [
    '            if (gradle.startParameter.taskNames.any { it.contains("Debug", ignoreCase = true) }) {',
    '                packaging {',
    '                    jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")',
    '                    jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")',
    '                    jniLibs.keepDebugSymbols.add("*/x86/*.so")',
    '                    jniLibs.keepDebugSymbols.add("*/x86_64/*.so")',
    '                }',
    '            }',
  ].join('\n');
  const normalizedGradle = buildGradle.replaceAll('\r\n', '\n');
  if (normalizedGradle.includes(unconditionalKeepSymbols)) {
    buildGradle = normalizedGradle.replace(unconditionalKeepSymbols, debugOnlyKeepSymbols);
  }
  writeFileSync(appBuildGradle, buildGradle, 'utf8');

  const loginActivityMarker = 'android:name=".LoginActivity"';
  let manifest = readFileSync(androidManifest, 'utf8');
  for (const permission of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC']) {
    const tag = `<uses-permission android:name="android.permission.${permission}" />`;
    if (!manifest.includes(tag)) manifest = manifest.replace('</manifest>', `    ${tag}\n</manifest>`);
  }
  if (!manifest.includes('android:name=".BackgroundNotificationService"')) {
    manifest = manifest.replace('</application>', '    <service android:name=".BackgroundNotificationService" android:exported="false" android:foregroundServiceType="dataSync" />\n    </application>');
  }
  manifest = setAndroidApplicationAttribute(manifest, 'android:icon', '@mipmap/ic_launcher');
  manifest = setAndroidApplicationAttribute(manifest, 'android:roundIcon', '@mipmap/ic_launcher_round');
  const installPermission = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />';
  if (!manifest.includes(installPermission)) {
    manifest = manifest.replace('</manifest>', `    ${installPermission}\n</manifest>`);
  }
  if (!manifest.includes(loginActivityMarker)) {
    const closingTag = '    </application>';
    if (!manifest.includes(closingTag)) throw new Error('AndroidManifest.xml 缺少 application 节点');
    manifest = manifest.replace(closingTag, `        <activity
            ${loginActivityMarker}
            android:exported="false"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:label="酷安官方授权登录" />
${closingTag}`);
  }
  writeFileSync(androidManifest, manifest, 'utf8');
  let filePaths = readFileSync(androidFilePaths, 'utf8');
  const localFilesPath = '<files-path name="coolapk_files" path="." /><external-files-path name="coolapk_external_files" path="." />';
  if (!filePaths.includes('name="coolapk_files"')) {
    filePaths = filePaths.replace('</paths>', `    ${localFilesPath}\n</paths>`);
    writeFileSync(androidFilePaths, filePaths, 'utf8');
  }
  const updatePath = '<files-path name="coolapk_updates" path="coolapk-desktop-update/" />';
  if (!filePaths.includes(updatePath)) {
    filePaths = filePaths.replace('</paths>', `    ${updatePath}\n</paths>`);
    writeFileSync(androidFilePaths, filePaths, 'utf8');
  }
  mkdirSync(androidActivityDir, { recursive: true });
  copyFileSync(join(root, 'src-tauri', 'android', 'MainActivity.kt'), join(androidActivityDir, 'MainActivity.kt'));
  copyFileSync(join(root, 'src-tauri', 'android', 'CoolNotificationHandler.kt'), join(androidActivityDir, 'CoolNotificationHandler.kt'));
  copyFileSync(join(root, 'src-tauri', 'android', 'BackgroundNotificationService.kt'), join(androidActivityDir, 'BackgroundNotificationService.kt'));
  copyFileSync(join(root, 'src-tauri', 'android', 'LoginActivity.kt'), join(androidActivityDir, 'LoginActivity.kt'));
}

function escapeProperty(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(':', '\\:').replaceAll('=', '\\=');
}

function configureSigning() {
  const storeFile = process.env.ANDROID_KEYSTORE_PATH || '';
  const keyAlias = process.env.ANDROID_KEY_ALIAS || '';
  const keyPassword = process.env.ANDROID_KEY_PASSWORD || '';
  const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD || keyPassword;
  const supplied = [storeFile, keyAlias, keyPassword, storePassword].filter(Boolean).length;

  if (supplied === 0) return false;
  if (supplied !== 4 || !existsSync(storeFile)) {
    throw new Error('Android 签名信息不完整，请检查 ANDROID_KEYSTORE_PATH、ANDROID_KEY_ALIAS、ANDROID_KEY_PASSWORD 和 ANDROID_KEYSTORE_PASSWORD。');
  }

  writeFileSync(keystoreProperties, [
    `storeFile=${escapeProperty(resolve(storeFile))}`,
    `storePassword=${escapeProperty(storePassword)}`,
    `keyAlias=${escapeProperty(keyAlias)}`,
    `keyPassword=${escapeProperty(keyPassword)}`,
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
  return true;
}

configureWindowsEnvironment();
mkdirSync(process.env.CARGO_TARGET_DIR || join(root, 'src-tauri', 'target'), { recursive: true });
ensureAndroidProject();
const signingConfigured = configureSigning();

if (!initOnly) {
  const buildArgs = forwardedArgs.length
    ? forwardedArgs
    : [...(fastRelease ? [] : ['--debug']), '--target', 'aarch64', '--apk'];
  if (!buildArgs.includes('--debug') && !signingConfigured) {
    throw new Error('Release APK/AAB 必须签名，请先配置 Android 签名环境变量。');
  }
  runTauri(['android', 'build', ...buildArgs]);
}
