// VENTORA Android app. The WebApp is copied into the APK's assets at build time: the source WebApp for a debug build,
// or the sealed release pack (-Pventora.webapp=<dir>, written by tools/release/build-release-webapp.cjs) for release.
// The release build reads its store settings from Gradle properties the owner sets in CI, never from the repository:
// ventora.applicationId, ventora.playKey (the Play Console licence key that verifies purchases), and the upload key
// (ventora.keystore, ventora.keystorePassword, ventora.keyAlias, ventora.keyPassword).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun ventoraProp(name: String): String = (findProperty(name) as String?)?.trim().orEmpty()

android {
    namespace = "com.ventora.game"
    compileSdk = 36

    defaultConfig {
        applicationId = ventoraProp("ventora.applicationId").ifEmpty { "com.example.ventora" }
        minSdk = 29
        targetSdk = 36
        versionCode = 362
        versionName = "3.0.0"
        buildConfigField("String", "PLAY_LICENSE_KEY", "\"${ventoraProp("ventora.playKey")}\"")
    }

    signingConfigs {
        create("upload") {
            val keystore = ventoraProp("ventora.keystore")
            if (keystore.isNotEmpty()) {
                storeFile = file(keystore)
                storePassword = ventoraProp("ventora.keystorePassword")
                keyAlias = ventoraProp("ventora.keyAlias")
                keyPassword = ventoraProp("ventora.keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "EDITION", "\"development\"")
        }
        release {
            buildConfigField("String", "EDITION", "\"release\"")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (ventoraProp("ventora.keystore").isNotEmpty()) signingConfig = signingConfigs.getByName("upload")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webapp"))
    // The save vault's platform-free core (also built and tested on the JVM by android/vault-jvm).
    sourceSets["main"].java.srcDir("src/main/vault")
}

// The game files: WebApp/ (or the sealed pack) → assets/WebApp/.
val copyWebApp by tasks.registering(Sync::class) {
    val pack = ventoraProp("ventora.webapp")
    from(if (pack.isNotEmpty()) file(pack) else rootProject.file("../WebApp"))
    into(layout.buildDirectory.dir("generated/webapp/WebApp"))
}
tasks.named("preBuild") { dependsOn(copyWebApp) }

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.android.billingclient:billing-ktx:8.0.0")
}
