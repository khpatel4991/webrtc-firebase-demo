import './style.css';

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot
} from 'firebase/firestore';

const {
  VITE_API_KEY,
  VITE_AUTH_DOMAIN,
  VITE_DATABASE_URL,
  VITE_PROJECT_ID,
  VITE_STORAGE_BUCKET,
  VITE_MESSAGING_SENDER_ID,
  VITE_APP_ID,
  VITE_MEASUREMENT_ID
} = import.meta.env

const firebaseConfig = {
  apiKey: VITE_API_KEY,
  authDomain: VITE_AUTH_DOMAIN,
  databaseURL: VITE_DATABASE_URL,
  projectId: VITE_PROJECT_ID,
  storageBucket: VITE_STORAGE_BUCKET,
  messagingSenderId: VITE_MESSAGING_SENDER_ID,
  appId: VITE_APP_ID,
  measurementId: VITE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let dataChannel = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesArea = document.getElementById('messagesArea');

// 1. Setup media sources

webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;

  // --- Setup Data Channel listener for the *potential* answerer ---
  // This needs to be set up *before* the answerer potentially receives an offer
  // that includes a data channel.
  pc.ondatachannel = (event) => {
    console.log('ondatachannel event received!');
    dataChannel = event.channel;
    setupDataChannelEvents(dataChannel);
  };
};

// 2. Create an offer
callButton.onclick = async () => {
  const callsCollectionRef = collection(db, 'calls'); // Get reference to 'calls' collection
  const callDocRef = doc(callsCollectionRef); // Create a new doc ref with auto-ID within 'calls'
  const offerCandidates = collection(callDocRef, 'offerCandidates'); // Subcollection ref
  const answerCandidates = collection(callDocRef, 'answerCandidates'); // Subcollection ref

  callInput.value = callDocRef.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
  };

  // Create the data channel *before* creating the offer
  dataChannel = pc.createDataChannel('chat'); // Label can be anything
  console.log('Data channel created by caller');
  setupDataChannelEvents(dataChannel); // Setup handlers for the caller's channel

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  // Set the offer data on the document using setDoc
  await setDoc(callDocRef, { offer });

  // Listen for remote answer using onSnapshot on the document reference
  onSnapshot(callDocRef, (snapshot) => { // Pass the doc ref to onSnapshot
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection using onSnapshot on the collection reference
  onSnapshot(answerCandidates, (snapshot) => { // Pass the collection ref to onSnapshot
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  // Get document and subcollection references using modular functions
  const callDocRef = doc(db, 'calls', callId); // Get doc ref using path segments
  const answerCandidates = collection(callDocRef, 'answerCandidates'); // Subcollection ref
  const offerCandidates = collection(callDocRef, 'offerCandidates');   // Subcollection ref

  pc.onicecandidate = (event) => {
    event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
  };

  // Get the document data once using getDoc
  const callDocSnapshot = await getDoc(callDocRef);
  const callData = callDocSnapshot.data();

  if (!callData || !callData.offer) {
    console.error("Call data or offer not found!");
    return; // Exit if the call document or offer doesn't exist
  }

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  // Update the document with the answer data using updateDoc
  await updateDoc(callDocRef, { answer });

  // Listen for offer candidates using onSnapshot on the collection reference
  onSnapshot(offerCandidates, (snapshot) => { // Pass the collection ref to onSnapshot
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};

// --- 4. Hangup ---
// Basic Hangup (you might want to add Firestore cleanup)
hangupButton.onclick = async () => {
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }
  if (pc) {
    pc.close();
    // Recreate peer connection for potential new call
    // pc = new RTCPeerConnection(servers);
    // You might need to re-attach event handlers (onicecandidate, ontrack, ondatachannel)
    // depending on how you structure re-initialization.
    console.log("Peer connection closed.");
  }

  // Reset UI
  webcamButton.disabled = false;
  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = true;
  sendButton.disabled = true;
  messageInput.disabled = true;
  messageInput.value = '';
  messagesArea.innerHTML = ''; // Clear messages
  callInput.value = '';
  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;

  // Optional: Add cleanup for Firestore documents (callDoc)
  const callId = callInput.value;
  if (callId) {
    try {
      // Delete subcollections first using your helper function
      // Make sure your deleteCollection function accepts the v9 'db' instance
      console.log(`Deleting subcollections for call: ${callId}`);
      await deleteCollection(db, `calls/${callId}/offerCandidates`);
      await deleteCollection(db, `calls/${callId}/answerCandidates`);

      // Delete the main call document using the modular 'deleteDoc' function
      console.log(`Deleting call document: ${callId}`);
      await deleteDoc(callDocRef);

      console.log(`Successfully deleted call ${callId} and its subcollections.`);

    } catch (error) {
      console.error("Error deleting call document or subcollections: ", error);
    }
  }
};

// 4. For message passing

function setupDataChannelEvents(channel) {
  channel.onopen = () => {
    console.log('Data channel is open');
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  };

  channel.onclose = () => {
    console.log('Data channel is closed');
    sendButton.disabled = true;
    messageInput.disabled = true;
  };

  channel.onerror = (error) => {
    console.error('Data channel error:', error);
  };

  channel.onmessage = (event) => {
    console.log('Message received:', event.data);
    // Display the received message
    const message = document.createElement('p');
    message.textContent = `Remote: ${event.data}`;
    messagesArea.appendChild(message);
    messagesArea.scrollTop = messagesArea.scrollHeight; // Scroll to bottom
  };
}

function sendMessage() {
  const messageText = messageInput.value;
  if (messageText && dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(messageText);
    console.log('Message sent:', messageText);
    // Display the sent message locally
    const message = document.createElement('p');
    message.textContent = `Local: ${messageText}`;
    message.style.textAlign = 'right'; // Optional: align local messages
    messagesArea.appendChild(message);
    messagesArea.scrollTop = messagesArea.scrollHeight; // Scroll to bottom
    messageInput.value = ''; // Clear input
  } else {
    console.log('Cannot send message. Data channel not ready or message empty.');
  }
}

// Add event listener for the send button
sendButton.onclick = sendMessage;
// Allow sending with Enter key in the input field
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});
