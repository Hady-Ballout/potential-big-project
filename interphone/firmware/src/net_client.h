// Wi-Fi + backend polling, on its own FreeRTOS task so HTTP round-trips never stall
// the door state machine in loop(). Commands arrive through a queue.
//
// Protocol (Supabase edge function `device-poll`):
//   POST {SUPABASE_FUNCTIONS_URL}/device-poll
//   Headers: x-device-token: <DEVICE_TOKEN>, Content-Type: application/json
//   Body:    {"fw":"0.1.0","state":"IDLE","ack":["<command id>", ...]}
//   200:     {"commands":[{"id":"uuid","action":"unlock","visit_id":"uuid"}]}
// Commands are acknowledged in the *next* poll (delivered_at gets set server side).
#pragma once
#include <Arduino.h>

struct DeviceCommand {
  char id[40];
  char action[16];
};

class NetClient {
 public:
  void begin();
  // Called from loop(). Returns true and fills cmd if a command is waiting.
  bool nextCommand(DeviceCommand& cmd);
  void reportState(const char* state);  // last known state, sent with each poll
  bool wifiConnected() const;
  bool online() const;          // backend reachable (or standalone mode with no URL)
  bool standalone() const { return standalone_; }
  const char* lastError() const { return last_error_; }

 private:
  static void taskEntry(void* self);
  void taskLoop();
  bool connectWifi();
  bool pollOnce();

  QueueHandle_t queue_ = nullptr;
  volatile bool online_ = false;
  bool standalone_ = false;
  uint32_t last_ok_ms_ = 0;
  char state_[16] = "BOOT";
  char last_error_[64] = "";
  // ids received in the previous poll, acked in the next one
  static const int kMaxAck = 8;
  char ack_[kMaxAck][40];
  int ack_count_ = 0;
};
