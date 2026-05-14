(function() {
  // Probe for engine-specific window objects
  const probe = () => {
    const findings = {
      cocos: !!(window.cc && window.cc.director),
      pixi: !!window.PIXI,
      phaser: !!window.Phaser,
      laya: !!(window.Laya || window.laya),
      egret: !!window.egret,
      three: !!window.THREE,
      playcanvas: !!(window.pc && window.pc.Application),
      construct: !!window.c3_runtime,
      luna: !!window.luna
    };

    // Send results back to content script
    window.postMessage({ type: 'ENGINE_PROBE_RESULT', findings }, '*');
  };

  // Run immediately and also on a short delay to catch late-loading globals
  probe();
  setTimeout(probe, 1000);
  setTimeout(probe, 3000);
})();
