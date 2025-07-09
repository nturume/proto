const { contextBridge } = require('electron');
console.log('Preload running, importing Platform...');
const Platform = require('./platform');

contextBridge.exposeInMainWorld('api', {
  getPlatform: () => {
    const instance = new Platform();
    return {
      getConfig: () => {
        try {
          return instance.getConfig()
        } catch (e) {
          throw e;
        }
      },
      setConfig: (config) => {
        try {
          instance.setConfig(config);
        } catch (e) { throw e; }
      },
      getDetails: () => {
        return {
          arch: instance.arch,
          platform: instance.platform,
          ramsize: instance.ramsize,
        }
      },
      prepareVM: async (dprog) => {
        try {
          await instance.prepareVM((p) => dprog(p));
        } catch (e) {
          throw e;
        }
      },
      runVM: () => {
        try {
          instance.runVM();
        } catch (e) {
          throw e;
        }
      }
    }
  }
});
