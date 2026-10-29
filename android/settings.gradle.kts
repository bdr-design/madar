// VENTORA for Android (approved «تجهيز الأندرويد»): one WebView shell around the same WebApp the iPhone app ships.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "Ventora"
include(":app")
