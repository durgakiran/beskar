### Test editor package

Testing editor package you need to consider only editor directory and the changes you make in the editor package should be tested in the editor-demo directory.

1. make changes in editor package
2. use node version 22. You have nvm available.
2. clean install dependencies `rm -rf node_modules package-lock.json`, followed by `npx npm install` in editor directory
3. run `npm run build` in editor package
4. clean install dependencies `rm -rf node_modules package-lock.json` in editor-demo directory, followed by `npx npm install` in editor-demo directory
5. run `npm run dev` in editor-demo directory
6. Try to auto verify using browser extension, that you have.
