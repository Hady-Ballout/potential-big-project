#include "net_client.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

void NetClient::begin() {
  standalone_ = (strlen(SUPABASE_FUNCTIONS_URL) == 0);
  if (standalone_) {
    Serial.println("[net] no SUPABASE_FUNCTIONS_URL: standalone mode (serial commands only)");
    online_ = true;
    return;
  }
  queue_ = xQueueCreate(8, sizeof(DeviceCommand));
  xTaskCreatePinnedToCore(taskEntry, "net", 8192, this, 1, nullptr, 0);
}

bool NetClient::nextCommand(DeviceCommand& cmd) {
  if (!queue_) return false;
  return xQueueReceive(queue_, &cmd, 0) == pdTRUE;
}

void NetClient::reportState(const char* state) {
  strncpy(state_, state, sizeof(state_) - 1);
}

bool NetClient::wifiConnected() const { return WiFi.status() == WL_CONNECTED; }

bool NetClient::online() const {
  if (standalone_) return true;
  return online_ && (millis() - last_ok_ms_) < (POLL_INTERVAL_MS * 5);
}

void NetClient::taskEntry(void* self) { static_cast<NetClient*>(self)->taskLoop(); }

bool NetClient::connectWifi() {
  if (wifiConnected()) return true;
  Serial.printf("[net] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (!wifiConnected() && millis() - start < 15000) {
    vTaskDelay(pdMS_TO_TICKS(500));
    Serial.print('.');
  }
  Serial.println();
  if (wifiConnected()) {
    Serial.printf("[net] connected, ip %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  strncpy(last_error_, "wifi timeout", sizeof(last_error_));
  return false;
}

bool NetClient::pollOnce() {
  WiFiClientSecure client;
  client.setInsecure();  // TODO(product): pin the Supabase CA certificate
  HTTPClient http;
  String url = String(SUPABASE_FUNCTIONS_URL) + "/device-poll";
  if (!http.begin(client, url)) { strncpy(last_error_, "http begin", sizeof(last_error_)); return false; }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);
  http.setTimeout(4000);

  JsonDocument body;
  body["fw"] = INTERPHONE_VERSION;
  body["state"] = state_;
  JsonArray ack = body["ack"].to<JsonArray>();
  for (int i = 0; i < ack_count_; ++i) ack.add(ack_[i]);
  String payload;
  serializeJson(body, payload);

  int code = http.POST(payload);
  if (code != 200) {
    snprintf(last_error_, sizeof(last_error_), "http %d", code);
    http.end();
    return false;
  }
  // Read the complete response through HTTPClient so chunked transfer encoding is decoded
  // before ArduinoJson sees the payload. Supabase edge responses may be chunked.
  String response = http.getString();
  http.end();
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) { snprintf(last_error_, sizeof(last_error_), "json %s", err.c_str()); return false; }

  ack_count_ = 0;  // previous acks delivered
  for (JsonObject c : doc["commands"].as<JsonArray>()) {
    DeviceCommand cmd{};
    strncpy(cmd.id, c["id"] | "", sizeof(cmd.id) - 1);
    strncpy(cmd.action, c["action"] | "", sizeof(cmd.action) - 1);
    if (xQueueSend(queue_, &cmd, 0) == pdTRUE && ack_count_ < kMaxAck) {
      strncpy(ack_[ack_count_++], cmd.id, sizeof(ack_[0]) - 1);
    }
  }
  last_error_[0] = 0;
  return true;
}

void NetClient::taskLoop() {
  for (;;) {
    if (!connectWifi()) {
      online_ = false;
      vTaskDelay(pdMS_TO_TICKS(WIFI_RETRY_MS));
      continue;
    }
    if (pollOnce()) {
      if (!online_) Serial.println("[net] backend online");
      online_ = true;
      last_ok_ms_ = millis();
    } else {
      if (online_) Serial.printf("[net] poll failed: %s\n", last_error_);
      online_ = false;
    }
    vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_MS));
  }
}
