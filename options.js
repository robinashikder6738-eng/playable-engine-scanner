document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('save');
  const scanFramesInput = document.getElementById('scan-frames');
  const status = document.getElementById('status');
  const defaultOptions = { scanFrames: true };

  async function loadOptions() {
    const data = await chrome.storage.local.get(['scannerOptions']);
    const options = { ...defaultOptions, ...(data.scannerOptions || {}) };
    scanFramesInput.checked = options.scanFrames;
  }
  
  saveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      scannerOptions: {
        scanFrames: scanFramesInput.checked
      }
    });
    status.textContent = '已保存';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });

  loadOptions().catch((err) => {
    status.textContent = `读取设置失败: ${err.message}`;
  });
});
