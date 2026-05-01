# Neuro Habit

Neuro Habit is a personal behavior and wellness tracking application focused on helping users build consistent daily routines. The app combines habit tracking, mood logging, activity insights, and gentle reminders to support long-term progress.

## Who It Is For

Neuro Habit is designed for students, professionals, workers, and anyone who wants a practical system to stay consistent, focused, and mentally aware throughout busy daily life. It is especially useful for people who want to turn goals into repeatable routines without using complex productivity tools.

## Key Features

- Habit Tracking: Monitor daily tasks and long-term consistency.
- Mood Logging: Keep a record of emotional well-being and personal notes.
- Activity Insights: View trends and performance data via interactive charts.
- Smart Reminders: Stay accountable with timely notifications.
- Health Integration: Sync data with Health Connect for a holistic view of wellness.

## Tech Stack

- Frontend: React Native with Expo (Development Client)
- State Management: React Hooks and Context API
- Navigation: React Navigation
- UI Components: custom components with React Native Reanimated for smooth transitions
- Data Visualization: Victory Native
- Backend & Database: Supabase
- AI Integration: OpenAI SDK
- Health Data: React Native Health Connect

## Getting Started

### Prerequisites

- Node.js (LTS version)
- npm or yarn
- Android Studio (for Android development)
- Expo Go or a Custom Development Build

### Installation

1. Clone the repository:
   git clone https://github.com/LazyCen/Neuro-Habit.git

2. Navigate to the project directory:
   cd Neuro-Habit/neuro-habit

3. Install dependencies:
   npm install

4. Set up environment variables:
   Create a .env file in the neuro-habit directory and add your Supabase and OpenAI credentials.

### Running the App

To start the development server:
npm run start

To run on an Android device/emulator:
npm run android

## APK Build (Install-Ready)

The project is configured to generate separate builds for different CPU architectures to optimize file size. Release APKs are located in:
neuro-habit/android/app/build/outputs/apk/release/

Available Architectures:

- app-arm64-v8a-release.apk (Recommended for most modern Android phones)
- app-armeabi-v7a-release.apk (For older 32-bit Android devices)
- app-x86-release.apk (For 32-bit emulators)
- app-x86_64-release.apk (For 64-bit emulators and some Chromebooks)

### Installing via ADB

To install the arm64 version on a connected device:
adb install -r "neuro-habit/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk"

## Inspiration

This project is inspired by the book Neuro Habits, with a focus on the idea that small repeated actions can create meaningful long-term behavioral change.
