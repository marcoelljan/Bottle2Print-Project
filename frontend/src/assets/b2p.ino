/*
// bottle2print_sensors.ino
// =======================================================
// Bottle2Print IoT System - Sensor Controller
// -------------------------------------------------------
// This Arduino program manages the full validation process
// of a bottle using multiple sensors.
//
// FLOW:
// 1. Wait for RFID tap
// 2. Open gate (if backend approves)
// 3. Detect bottle via IR sensor
// 4. Check material via capacitive sensor
// 5. Measure height via ToF sensor
// 6. Measure weight via load cell
// 7. Send data to backend for ACCEPT / REJECT
// =======================================================


// ================= LIBRARIES =================
#include <SPI.h>        // For RFID communication
#include <MFRC522.h>   // RFID module
#include <Servo.h>     // Servo motor control
#include <HX711_ADC.h> // Load cell amplifier
#include <Wire.h>      // I2C communication
#include <VL53L0X.h>   // Time-of-Flight distance sensor


// ================= RFID SETUP =================
// SPI pins: SS=D10, RST=D9
#define RFID_SS   10
#define RFID_RST  9
MFRC522 rfid(RFID_SS, RFID_RST);


// ================= SERVO (GATE) =================
#define SERVO_PIN 8
#define GATE_OPEN_ANGLE  90
#define GATE_CLOSE_ANGLE 0
Servo gateServo;


// ================= SENSOR PINS =================
#define IR_PIN 2     // Detects object passing through gate
#define CAP_PIN 4    // Detects plastic (capacitive sensor)


// ================= LOAD CELL =================
#define HX711_DOUT 3
#define HX711_SCK  5
HX711_ADC loadCell(HX711_DOUT, HX711_SCK);

// Calibration factor (adjust based on your calibration)
const float SCALE = 254.063949;


// ================= TOF SENSOR =================
VL53L0X tof;

// Distance from sensor to base (used to compute bottle height)
#define TOF_MOUNT_HEIGHT_MM 350


// ================= TIMEOUTS =================
#define GATE_TIMEOUT_MS 10000   // Max time gate stays open
#define RFID_TIMEOUT_MS 5000    // Max wait for backend response


// ================= SYSTEM STATES =================
enum State {
  IDLE,              // Waiting for RFID
  RFID_RECEIVED,     // RFID scanned, waiting backend
  GATE_OPEN,         // Gate is open
  CAP_CHECK,         // Check plastic type
  TOF_CHECK,         // Measure height
  LOADCELL_CHECK,    // Measure weight
  VALIDATION_DONE    // Waiting backend decision
};

State currentState = IDLE;


// ================= VARIABLES =================
unsigned long gateOpenedAt = 0;
unsigned long rfidReceivedAt = 0;

String lastRFID = "";


// ================= SETUP =================
void setup() {
  Serial.begin(9600);   // Communication with backend

  // Initialize RFID
  SPI.begin();
  rfid.PCD_Init();

  // Initialize servo (gate closed by default)
  gateServo.attach(SERVO_PIN);
  gateServo.write(GATE_CLOSE_ANGLE);

  // Set sensor pin modes
  pinMode(IR_PIN, INPUT);
  pinMode(CAP_PIN, INPUT);

  // Initialize ToF sensor
  Wire.begin();
  tof.init();
  tof.setTimeout(500);
  tof.startContinuous();

  // Initialize load cell
  loadCell.begin();
  loadCell.setCalFactor(SCALE);
  loadCell.tareNoDelay();

  // Wait until load cell is calibrated
  while (!loadCell.getTareStatus()) {
    loadCell.update();
  }

  Serial.println("READY"); // System ready signal
}


// ================= MAIN LOOP =================
void loop() {
  loadCell.update(); // Continuously update weight readings


  // ===== HANDLE SERIAL COMMANDS (FROM BACKEND) =====
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    // RESET command: restart whole process
    if (cmd == "RESET") {
      resetFlow();
      Serial.println("RESET:OK");
      return;
    }

    // Handle commands based on current state
    if (currentState == RFID_RECEIVED) {
      if (cmd == "OPEN_GATE") {
        gateServo.write(GATE_OPEN_ANGLE);
        gateOpenedAt = millis();
        currentState = GATE_OPEN;
      } else {
        currentState = IDLE;
      }
      return;
    }

    if (currentState == VALIDATION_DONE) {
      if (cmd == "ACCEPT") {
        Serial.println("DONE:ACCEPTED");
        resetFlow();
      } else if (cmd == "REJECT") {
        Serial.println("DONE:REJECTED");
        resetFlow();
      }
      return;
    }
  }


  // ===== STATE MACHINE =====
  switch (currentState) {

    // ---- WAIT FOR RFID ----
    case IDLE:
      checkRFID();
      break;


    // ---- RFID SCANNED ----
    case RFID_RECEIVED:
      if (millis() - rfidReceivedAt > RFID_TIMEOUT_MS) {
        Serial.println("RFID:TIMEOUT");
        currentState = IDLE;
      }
      break;


    // ---- GATE OPEN ----
    case GATE_OPEN:
      // Close gate if timeout reached
      if (millis() - gateOpenedAt > GATE_TIMEOUT_MS) {
        gateServo.write(GATE_CLOSE_ANGLE);
        Serial.println("TIMEOUT");
        currentState = IDLE;
      }

      // Detect bottle passing
      if (digitalRead(IR_PIN) == LOW) {
        gateServo.write(GATE_CLOSE_ANGLE);
        Serial.println("IR:DETECTED");
        delay(300);
        currentState = CAP_CHECK;
      }
      break;


    // ---- CAPACITIVE SENSOR CHECK ----
    case CAP_CHECK: {
      delay(200);

      bool capDetected = (digitalRead(CAP_PIN) == LOW);

      if (capDetected) {
        Serial.println("CAP:PASS");  // Plastic detected
        currentState = TOF_CHECK;
      } else {
        Serial.println("CAP:FAIL");  // Not plastic
        resetFlow();
      }
      break;
    }


    // ---- HEIGHT MEASUREMENT (TOF) ----
    case TOF_CHECK: {
      delay(200);

      uint16_t rawDist = tof.readRangeContinuousMillimeters();

      if (tof.timeoutOccurred()) {
        Serial.println("TOF:FAIL:TIMEOUT");
        resetFlow();
        break;
      }

      int bottleHeight = TOF_MOUNT_HEIGHT_MM - (int)rawDist;

      Serial.print("TOF:HEIGHT:");
      Serial.println(bottleHeight);

      currentState = LOADCELL_CHECK;
      break;
    }


    // ---- WEIGHT MEASUREMENT ----
    case LOADCELL_CHECK: {
      delay(500);

      float weight = loadCell.getData();

      Serial.print("LOADCELL:WEIGHT:");
      Serial.println(weight, 1);

      currentState = VALIDATION_DONE;
      break;
    }


    // ---- WAIT FOR FINAL DECISION ----
    case VALIDATION_DONE:
      // Waiting for ACCEPT / REJECT from backend
      break;
  }
}


// ================= RFID FUNCTION =================
void checkRFID() {
  // Check if a new card is present
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  lastRFID = "";

  // Convert UID to string
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) lastRFID += "0";
    lastRFID += String(rfid.uid.uidByte[i], HEX);
  }

  lastRFID.toUpperCase();

  // Stop reading
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Send RFID to backend
  Serial.print("RFID:");
  Serial.println(lastRFID);

  rfidReceivedAt = millis();
  currentState = RFID_RECEIVED;
}


// ================= RESET FUNCTION =================
void resetFlow() {
  currentState = IDLE;
  lastRFID = "";

  // Ensure gate is closed
  gateServo.write(GATE_CLOSE_ANGLE);
}*/