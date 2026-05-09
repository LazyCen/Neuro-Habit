package com.neurohabit.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/**
 * Mandatory activity for Health Connect integration.
 * This activity is launched when the user clicks on the app in Health Connect settings
 * to see why the app needs access to their health data.
 */
class HealthConnectRationaleActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // For now, we simply redirect to the MainActivity or show a simple message.
        // Most users will never see this directly as it's a system requirement.
        finish()
    }
}
