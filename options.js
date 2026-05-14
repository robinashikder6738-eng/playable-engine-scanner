document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('save');
  
  saveBtn.addEventListener('click', () => {
    // Current version doesn't store settings yet
    saveBtn.textContent = '已保存!';
    setTimeout(() => {
      saveBtn.textContent = '保存设置';
    }, 2000);
  });
});
