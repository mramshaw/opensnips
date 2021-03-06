/* global window */
/* global Paho */

import React, { Component } from 'react'

export default class SnipsAppServer extends Component {

    constructor(props) {
        super(props);
        
        this.failCount = 0;
        this.mqttClient = null;
        this.clientId = this.props.clientId ? this.props.clientId :  'client'+parseInt(Math.random()*100000000,10);
        this.state={};
        this.onMessageArrived = this.onMessageArrived.bind(this);
        this.onConnect = this.onConnect.bind(this);
        
     }   
    componentDidMount() {
         this.mqttConnect.bind(this)() ;
    };
        
   /**
     * Connect to mqtt server
    */
    mqttConnect() {
        let server = this.props.mqttServer && this.props.mqttServer.length > 0 ? this.props.mqttServer : 'localhost';
        let port = this.props.mqttPort && this.props.mqttPort > 0 ? parseInt(this.props.mqttPort,10) : 9001
        console.log(['APP SERVER CONNECT',server,port,this.clientId]);
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
        console.log(['APP SERVER CONNECTED',this.eventFunctions]);
      this.setState({'connected':true});
      this.failCount = 0;
      that.mqttClient.subscribe('#',{});
      
      //this.startRecorder();
    }
 
    /**
     * When the client loses its connection, reconnect after 5s
     */ 
    onConnectionLost(responseObject) {
        console.log(['APP SERVER DISCONNECTED']);
        let that = this;
        this.setState({'connected':false,'activated':false});
        if (responseObject.errorCode !== 0) {
            console.log([" APP SERVER onConnectionLost:"+responseObject.errorMessage]);
            let timeout=1000;
            if (this.failCount > 5) {
                timeout=10000;
            }
            this.failCount++;
            setTimeout(function() {
              that.mqttClient.connect({onSuccess:that.onConnect});  
            },timeout)
        }

    }
    ;
    
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
     * Send Mqtt message to toggle on hotword
     * Used to forcibly initialise the local hotword server.
     */ 
    sendEndSession(sessionId) {
        let that = this;
        if (that.state && that.state.connected) {
            let message = new Paho.MQTT.Message(JSON.stringify({sessionId:sessionId}));
            message.destinationName = "hermes/dialogueManager/endSession";
            that.mqttClient.send(message);
            
        }
    };
    
    onMessageArrived(message) {
        let that = this;
        //console.log(['APP SERVER MESSAGE ARRIVED',message]);
        let parts = message.destinationName ? message.destinationName.split("/") : [];
        if (parts.length > 0 && parts[0] === "hermes") {
            if (parts.length > 1 &&  parts[1] === "intent") {
                console.log(['APP SERVER MESSAGE ARRIVED',message,this.props.intents]);
                let payload = {};
                let intent = parts[2];
                if (intent && intent.length > 0) {
                    try {
                        payload = JSON.parse(message.payloadString);
                          
                        if (this.props.intents && this.props.intents.hasOwnProperty(intent) && this.props.intents[intent]) {
                            this.props.intents[intent].bind(this)(this.cleanSlots(payload.slots)).then(function() {
                                that.sendEndSession.bind(that)();
                            });
                            console.log(['APP SERVER MESSAGE SUCCESS',intent,payload]);
                        } else {
                            console.log(['APP SERVER MESSAGE no intent',intent,payload]);
                        }
                        
                    } catch (e) {
                        console.log(['APP SERVER FAILED TO PARSE PAYLOAD']);
                    }                    
                }
            }
        }
                
       
    }
    render() {
        return <span id="snipsappserver" ></span>
    };
}
