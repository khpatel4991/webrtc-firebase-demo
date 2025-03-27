# Video Chat with WebRTC and Firebase

Build a 1-to-1 video chat and message chat feature with WebRTC, Firestore, and JavaScript. 

Watch the [WebRTC Explanation on YouTube](https://youtu.be/WmR9IMUD_CY) and follow the full [WebRTC Firebase Tutorial](https://fireship.io/lessons/webrtc-firebase-video-chat) on Fireship.io. 


## Usage

Update the firebase project config in the main.js file. 

```
git clone <this-repo>
npm install

npm run dev
```

### Steps

1. Open 2 tabs with dev server running.
2. Click "Start webcam" on both tabs.
3. On tab 1, Click "Create Call(offer)."
4. On tab 1, copy the offer id added in input.
5. On tab 2, paste the offer id in the input.
6. On tab 2, Click "Answer."

At this point, we should have video feed from both tabs.

Now you can try the chat functionality.

## Changelog

### 0.0.1

- Upgrade npm packages.
- Use env variables for firebase config.
- Add chat functionality over data channel.
