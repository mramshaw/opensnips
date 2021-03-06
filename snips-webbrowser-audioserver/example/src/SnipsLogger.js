/* global window */
/* global Paho */

import React, { Component } from 'react'
import eventFunctions from './eventFunctions'
import Crunker from 'crunker'
const UNKNOWNSITE = 'Unknown Site';
const UNKNOWNSESSION = 'Unknown Session';

export default class SnipsLogger extends Component {

    constructor(props) {
        super(props);
        this.eventFunctions = eventFunctions;
        
        this.failCount = 0;
        this.mqttClient = null;
        this.clientId = this.props.clientId ? this.props.clientId :  'client'+parseInt(Math.random()*100000000,10);
        this.state={sites:{},messages:[],session:{},audioListening:{},hotwordListening:{},showLogMessages:{},sessionStatus:{},sessionStatusText:{}};
        //messages:[],sessions:{},intents:[],asr:[],tts:{'unknownSession':[]}};
        this.audioBuffers={};
        // state
        this.connected = false;
        
       // console.log('LOGGER CONSTRUCT');
        
        this.getSession = this.getSession.bind(this);
        this.saveSession = this.saveSession.bind(this);
        this.updateSession = this.updateSession.bind(this);
        this.onMessageArrived = this.onMessageArrived.bind(this);
        this.onConnect = this.onConnect.bind(this);
        this.logAudioBuffer = this.logAudioBuffer.bind(this);
        this.toggleMessageExpansion = this.toggleMessageExpansion.bind(this);
        this.isLogMessageExpanded = this.isLogMessageExpanded.bind(this);
        this.updateSessionStatus = this.updateSessionStatus.bind(this);
     }   
        

    componentDidMount() {
        // console.log('LOGGER MOUNT');
         this.mqttConnect.bind(this)() ;
    };    

   /**
     * Connect to mqtt server
    */
    mqttConnect() {
        let server = this.props.mqttServer && this.props.mqttServer.length > 0 ? this.props.mqttServer : 'localhost';
        let port = this.props.mqttPort && this.props.mqttPort > 0 ? parseInt(this.props.mqttPort,10) : 9001
        console.log('LOGGER CONNECT',server,port,this.clientId);
        this.mqttClient = new Paho.MQTT.Client(server,port, this.clientId);
        this.mqttClient.onConnectionLost = this.onConnectionLost.bind(this);
        this.mqttClient.onMessageArrived = this.onMessageArrived.bind(this);
        this.mqttClient.connect({onSuccess:this.onConnect.bind(this)});
    };
        
    /**
     * Subscribe to to mqtt channels then start recorder
     */
    onConnect() {
        let that = this;
        console.log(['LOGGER CONNECTED',this.eventFunctions]);
      //this.setState({'connected':true});
      this.failCount = 0;
      that.mqttClient.subscribe('#',{});
      
      //this.startRecorder();
    }
 
    /**
     * When the client loses its connection, reconnect after 5s
     */ 
    onConnectionLost(responseObject) {
        console.log('LOGGER DISCONNECTED');
        let that = this;
        //this.setState({'connected':false,'activated':false});
        if (responseObject.errorCode !== 0) {
            console.log("onConnectionLost:"+responseObject.errorMessage);
            let timeout=1000;
            if (this.failCount > 5) {
                timeout=10000;
            }
            this.failCount++;
            setTimeout(function() {
              that.mqttClient.connect({onSuccess:that.onConnect});  
            },timeout)
        }

    };
    
    cleanSlots(slots) { 
        let final={};
        if (slots) {
            slots.map(function(slot) {
                final[slot.slotName] = {type:slot.value.kind,value:slot.value.value}
            });
        }
        return final;
    };
    
    /**
     * Get or create an audio buffer for the siteId
     */
    getAudioBuffer(siteId) {
        if (siteId) {
            if (this.audioBuffers.hasOwnProperty(siteId)) {
                return this.audioBuffers[siteId];
            } else {
                this.audioBuffers[siteId] = [];
                return this.audioBuffers[siteId];
            }
        }
    };
    
    /**
     * Get or create an audio buffer for the siteId
     */
    appendAudioBuffer(siteId,buffer) {
        if (siteId) {
            if (this.state.audioListening[siteId]) {
                let currentBuffer = this.getAudioBuffer(siteId);
                currentBuffer.push(buffer);
            }
        }
        // merge current and buffer
        
        //this.audioBuffers[siteId] = [];
    };


    /**
     * Get or create an audio buffer for the siteId
     */
    resetAudioBuffer(siteId) {
        console.log(['RESET AUDIO']);
        this.audioBuffers[siteId] = [];
    };
    
    logAudioBuffer(payload) {
        return;
        let that = this;
        let siteId = payload.siteId;
        // save to sites/sessions
        console.log(['EXPORT AUDIO',this.getAudioBuffer(siteId)]);
        let audioContext = window.AudioContext || window.webkitAudioContext;
        let context = new audioContext();
        let audioBuffers=[];    
        let promises = [];
        this.getAudioBuffer(siteId).map(function(bytes,key) {
            let p = new Promise(function(resolve,reject) {
                console.log(['HANDLE BUFFER',bytes]);
                var buffer = new Uint8Array( bytes.length );
                if (bytes.length > 0) {
                    buffer.set( new Uint8Array(bytes), 0 );
                    try {
                        context.decodeAudioData(buffer.buffer, function(audioBuffer) {
                            console.log(['PUSH BUFFER',audioBuffer]);
                            audioBuffers.push(audioBuffer);
                            resolve(audioBuffer);
                        });
                        
                    } catch (e) {
                        // trash buffer
                        reject();
                    }   
                }
            });
    
        
            promises.push(p);
        });
        
        Promise.all(promises).then(function(allBuffers) {
            console.log(['MERGED allBuffers',allBuffers]);
            let merger =  new Crunker();
            try {
                let output = merger.export(merger.mergeAudio(allBuffers), "audio/wav");
                console.log(['MERGED AUDIO',output]);
                that.updateSession(payload,function(session) {
                     if (!session.audio) session.audio=[];
                     that.blobToDataUrl(output.blob).then(function(dataUrl) {
                        console.log(['BLOG TO DATA URL',dataUrl,output.blob]);
                        session.audio.push(dataUrl);               
                        // start again
                        that.resetAudioBuffer(siteId); 
                     });
                   return session;
                });                
            } catch (e) {
                console.log(e.message);
            }
        });
    };
    
    blobToDataUrl(blob) {
        return new Promise((fulfill, reject) => {
            let reader = new FileReader();
            reader.onerror = reject;
            reader.onload = (e) => fulfill(reader.result);
            reader.readAsDataURL(blob);
        })
    }
     

    
    /*
     *  Lookup session, use callback to make changes and restore session to state
     */
    updateSession(payload,callback) {
        let sessionId = payload && payload.sessionId && payload.sessionId.length > 0 ? payload.sessionId : null;
        let siteId = payload && payload.siteId && payload.siteId.length > 0 ? payload.siteId : null;
        let session = this.getSession(siteId,sessionId);
            
        //console.log(['update session',sessionId,siteId,session,payload,callback]);
        //if (payload) {
          //  console.log(['LOGGER UDPATE SESSION',session,payload]);
            if (session) {
                callback(session).then(function(session) {
          //          console.log(['LOGGER UDPATED SESSION',payload.siteId,payload.sessionId,session]);
                    this.saveSession(payload.siteId,payload.sessionId,session);                    
                });
            } 
            //else {
                //throw 'NO FIND SESSION '+JSON.stringify(payload) + JSON.stringify(this.state.sites);
            //}
       // }
    };
   

    /** 
     * Get a session for a given siteId and sessionId
     * If siteId is absent, lookup by session id Index
     * If session does not already exist, create it.
     */
    getSession(siteIdIn,sessionId) {
        //console.log(['LOGGER START GET SESSION',siteIdIn,sessionId,JSON.stringify(this.state.sites)]);
        // ensure sessionId
        //let sessionId =  sessionIdIn && sessionIdIn.length > 0 ? sessionIdIn : 'unknownSession';
        if (sessionId && sessionId.length > 0){
            // ensure siteId
            let siteId=siteIdIn;
            if (!siteIdIn ||siteIdIn.length === 0) {
                siteId = this.state.sessions[sessionId];
            }        
          // console.log(['LOGGER START GET forced params',siteId,sessionId,JSON.stringify(this.state.sites)]);
            if (siteId && siteId.length>0) {
                // lookup session by siteId and sessionId
                if (this.state.sites && this.state.sites.hasOwnProperty(siteId) && this.state.sites[siteId].hasOwnProperty(sessionId) && this.state.sites[siteId][sessionId]) {
                  // console.log('GOT EXISTING SESSION',this.state.sites[siteId][sessionId]);
                    return this.state.sites[siteId][sessionId];
                } else {
                    //console.log('CREATE NEW SESSION');
                    // fallback, create a new session
                    let sites = this.state.sites ? this.state.sites : {};
                    let sessions = this.state.sessions ? this.state.sessions : {};
                    if (!sites.hasOwnProperty(siteId)) sites[siteId] = {};
                    let newSession={starttimestamp: new Date().getTime()};
                    if (!sites[siteId].hasOwnProperty(sessionId)) sites[siteId][sessionId]=newSession;
                    sessions[sessionId] = siteId;
                    this.setState({sites:sites,sessions:sessions});
                    return sites[siteId][sessionId];
                }
            }             
        }        
    }; 
    
    saveSession(siteIdIn,sessionIdIn,session) {
         let sessionId =  sessionIdIn && sessionIdIn.length > 0 ? sessionIdIn : 'unknownSession';
        // ensure siteId
        let siteId=siteIdIn;
        if (!siteIdIn ||siteIdIn.length === 0) {
            siteId = this.state.sessions[sessionId];
        }        
        if (siteId && siteId.length>0) {
            let sites = this.state.sites;
            sites[siteId][sessionId] = session;
            this.setState({sites:sites});
        }
    };

    
    onMessageArrived(message) {
        let that = this;
        let parts = message.destinationName ? message.destinationName.split("/") : [];
        if (parts.length > 0 && parts[0] === "hermes") {
            if (parts.length > 1 &&  parts[1] === "audioServer") {
                var audio = message.payloadBytes;
                if (parts.length > 3) {
                    let siteId = parts[2];
                    let action = parts[3];
                    if (action === "playBytes") {
                    
                    } else if (action === "playFinished") {
                    
                    } else if (action === "audioFrame") {
                        this.appendAudioBuffer(siteId,audio);
                     } 
                } 
                    /* Audio Server */
                //hermes/audioServer/<siteId>/playBytes/< Request Id>
                // hermes/audioServer/<siteId>/playFinished
                //hermes/audioServer/<siteId>/audioFrame/<Optional Request Id>
                
                
            } else {
                let payload = {};
                try {
                  payload = JSON.parse(message.payloadString);  
                } catch (e) {
                }
                //console.log(['LOGGER PRE MESSAGE',message.destinationName,message,JSON.stringify(this.state.sites)]);
                
               // limit by siteId prop ??
              // if (!this.props.siteId || (this.props.siteId && payload.siteId == this.props.siteId)) {
                    // special case for hotword parameter in url
                    let functionKey = message.destinationName;
                    if (parts.length > 3 && parts[0] === "hermes" && parts[1] === "hotword" && parts[3] === "detected") {
                        functionKey = 'hermes/hotword/#/detected'
                    // special case for intent parameter in hermes/intent
                    } else if (parts.length > 1 && parts[0] === "hermes" && parts[1] === "intent") {
                        functionKey = 'hermes/intent/#';
                        
                    }
                    
                    if (this.eventFunctions.hasOwnProperty(functionKey)) {
                        //console.log(['AAA:: EVENT FN HOTWORD DETECT ',functionKey,this.eventFunctions[functionKey]]);
                        let p = that.eventFunctions[functionKey].bind(that)(payload);
                        //console.log(['AAA::EVENT FN HOTWORD callback ',functionKey,p]);
                        //if (p && typeof p.then === "function") 
                        p.then(function(session) {
                           // console.log(['AAA::RESOLVED INTERNAL PROMISE',functionKey,session,that.props.eventCallbackFunctions]);
                            
                            if (that.props.eventCallbackFunctions && that.props.eventCallbackFunctions.hasOwnProperty(functionKey) &&  that.props.eventCallbackFunctions[functionKey]) {
                             //   console.log(['AAA::RUN CALLBACK ',that.props.eventCallbackFunctions[functionKey]]);
                                that.props.eventCallbackFunctions[functionKey].bind(that)(payload,session);
                               // console.log(['AAA::RAN CALLBACK ',that.props.eventCallbackFunctions[functionKey]]);
                            }
                        }).catch(function(e) {
                            console.log(e);
                        });
                    } else {
                       // console.log(['AAA:: NO FUNCTION',functionKey]);
                    }
                        
                    let messages = this.state.messages;
                    messages.push({sessionId:payload.sessionId,payload: <div style={{backgroundColor:'lightgrey'}}><hr/><div style={{backgroundColor:'lightblue'}}>{JSON.stringify(payload)}</div><hr/><div style={{backgroundColor:'lightgreen'}}>{JSON.stringify(this.state.sites)}</div><hr/></div>  ,text:message.destinationName});
                    // + ' ' + JSON.stringify(payload)
                    this.setState({messages:messages});
                    
                    console.log(['LOGGER MESSAGE',message.destinationName,message,JSON.stringify(this.state.sites)]);
                            //,this.sessionId,mainTopic,audio.length,payload,message                   
               //}
            } 
        }
    };
    
    toggleMessageExpansion(e,key) {
        let showLogMessages = this.state.showLogMessages;
        if (this.isLogMessageExpanded(key)) {
            showLogMessages[key] = false;
        } else {
            showLogMessages[key] = true;
        }
       // console.log(['TOGGLE',showLogMessages]);
        this.setState({showLogMessages:showLogMessages});
    };
    
    isLogMessageExpanded(key) {
        if (this.state.showLogMessages.hasOwnProperty(key) && this.state.showLogMessages[key]) {
            return true;
        }
        return false;
    };
    
    
    updateSessionStatus(siteKey,session) {
        let that = this;
         let sessionStatus=0;
        let sessionKey = session.sessionId;
        if (that.state.hotwordListening[siteKey]) sessionStatus=1;
        if (that.state.audioListening[siteKey]) sessionStatus=2;
        if (session.queued) sessionStatus=3;
        if (session.started) sessionStatus=4;
        if (session.intents && session.asr && session.intents.length < session.asr.length) sessionStatus=5;
        if (session.intents && session.asr && session.intents.length === session.asr.length) sessionStatus=6;
        if (session.ended) sessionStatus=7;
        let statusTexts=['starting','hotword','listening','queued','started','transcribed','interpreted','ended'];
        let statusText= statusTexts[sessionStatus];
        let allSessionsStatus = that.state.sessionStatus;
        let allSessionsStatusText = that.state.sessionStatusText;
        allSessionsStatus[sessionKey] = sessionStatus;
        allSessionsStatusText[sessionKey] = statusText;
      //  console.log(['UPDATE SESSION STATUS',{sessionStatus:allSessionsStatus,sessionStatusText:allSessionsStatusText}]);
        that.setState({sessionStatus:allSessionsStatus,sessionStatusText:allSessionsStatusText});
    }; 
    
    render() {
        let that = this;
        let sitesRendered = Object.keys(this.state.sites).map(function(siteKeyIn) {
            let siteKey = siteKeyIn && siteKeyIn.length > 0 ? siteKeyIn : 'unknownSite';
            let site = that.state.sites[siteKey];
            let sessions = Object.values(site);
            sessions.sort(function(a,b) {
                if (a.starttimestamp < b.starttimestamp) return 1;
                else return -1;
            });
            if (!that.props.siteId || (that.props.siteId && siteKey == that.props.siteId)) {
                let sessionsRendered = sessions.map(function(session,sessionLoopKey) {
                //let session = that.state.sites[siteKey][sessionKey];
                //if () {
                if (session)  {
                  //  console.log(['RENDER LOGS',that.state.messages]);
                    let logs = that.state.messages.map(function(val,key) {
                    //    console.log(['LOG',val,key,session.sessionId,val.sessionId]);
                        if (val.sessionId == session.sessionId) {
                            return <div key={key} >
                                <button onClick={(e) => that.toggleMessageExpansion(e,key)} >+</button> 
                                 &nbsp;&nbsp;{val.text}
                                {that.isLogMessageExpanded(key) && <div>{val.payload}</div>}
                            </div>                            
                        }
                    });
                    
                    let sessionStatus = that.state.sessionStatus[session.sessionId];
                    //let statusColors=['lightgrey','lightblue','lightgreen','lightorange','lightgreen','lightred'];
                    let statusTexts=['starting','hotword','listening','queued','started','transcribed','interpreted','ended'];
                    let statusText= that.state.sessionStatusText[session.sessionId];
                    //let statusColor= statusColors[sessionStatus];
                    let sessionClass = 'session-'+statusText;
                    let sessionStyle = {margin:'1em', padding:'1em', border: '2px solid black',borderRadius:'10px'};
                    //console.log(sessionStyle);
                    let sessionItems = [];
                    if (session.asr) sessionItems = session.asr.map(function(transcript,ikey) {
                        let slotValues = [];
                        
                        if (session.intents && session.intents.length > ikey && session.intents[ikey]) slotValues = session.intents[ikey].slots.map(function(slot,skey) {
                            return <li key={skey}>{slot.slotName.split('_').join(' ')} {slot.value.value}</li>
                        });
                        return <div key={ikey}>
                        {session.audio && session.audio.length > ikey && session.audio[ikey]  && session.audio[ikey].length > 0 && <audio src={session.audio[ikey]} controls={true} style={{float:'right'}}/>}
                        <div style={{marginBottom:'1em',fontWeight:'bold'}}>
                            {transcript.text} 
                        </div>
                        <div ><hr style={{height:'1px', width:'100%'}}/></div>
                        <div>
                            {slotValues && <ul>{slotValues}</ul>}
                        </div>
                        <div ><hr style={{height:'1px', width:'100%'}}/></div>
                        <div><i>{session.tts && session.tts.length > ikey && session.tts[ikey] && session.tts[ikey].text}</i></div>
                       
                        
                        </div>
                    });
                    //<span>{session.intents && session.intents.length > ikey && session.intents[ikey] && JSON.stringify(session.intents[ikey])}</span>
                    if (session.started && session.sessionId) {
                            return <div className={sessionClass} style={sessionStyle}  key={sessionLoopKey} >
                        <h4>{session.sessionId} {that.state.sessionStatusText[session.sessionId]} </h4>
                        <div >{sessionItems}</div>
                        <div >{logs}</div>
                        </div>
                    }   
                    //
                                          
                }
            });
            let activityStyle={padding:'0.2em',borderRadius:'5px',float:'right',marginRight:'4em'};
            return <div style={{margin:'1em',padding:'1em', border: '2px solid black',borderRadius:'10px'}} key={siteKey}>
                {siteKey} 
                {that.state.hotwordListening[siteKey] && <b style={Object.assign({backgroundColor:'lightpink',border:'1px solid red'},activityStyle)} >Hotword</b>}
                {that.state.audioListening[siteKey] && <b style={Object.assign({backgroundColor:'lightgreen',border:'1px solid green'},activityStyle)}>Listening</b>}
                <div>{sessionsRendered}</div>
            </div>
            }

        });
        //
        return <b>
        <br/><br/><br/><br/><br/><br/><br/>
         <hr/>
         {sitesRendered}
        <br/>
        <hr/>
        <h4>Sites</h4>
         {JSON.stringify(this.state.sites)}
        
        </b>;
    }
    
}

   //<h4>Sessions</h4>
         //{JSON.stringify(this.state.sessions)}
        //<hr/>
        //<h4>Audio On</h4>
         //{JSON.stringify(this.state.audioListening)}
        //<hr/>
        //<h4>Hotword On</h4>
         //{JSON.stringify(this.state.hotwordListening)}
        //<br/><hr/>
         //<hr/>
     
