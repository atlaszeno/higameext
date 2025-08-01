let settings = {};

exports.set_settings = (newSettings) => {
  settings = { ...settings, ...newSettings };
  return settings;
};

exports.get_settings = () => {
  return settings;
};
