const { PvRecorder } = require('@picovoice/pvrecorder-node');

PvRecorder.getAvailableDevices().forEach((name, index) => {
  console.log(index, name);
});
