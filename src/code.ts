figma.showUI(__html__, { width: 360, height: 480 });

figma.ui.onmessage = (msg: any) => {
  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  }
};
