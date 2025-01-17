import { Address, BaseAddress, BigNum, Ed25519KeyHashes, LinearFee, Transaction, TransactionBuilderConfigBuilder, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-asmjs';
import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { WalletInfo, WALLET_IDS } from './wallets/base';
import { enable, getAvailableWallets, getBalance, getChangeAddress, getNetwork, getRewardAddresses, getUnusedAddresses, getUsedAddresses, getUtxos, signData, signTx, submitTx } from './walletsGateway';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs'

var md5 = require('md5');

let Buffer = require('buffer/').Buffer

function WalletCard(props: { wallet: WalletInfo, handleClick: Function }) {
  return (
        <div className="p-8 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer flex h-full flex-col ">
          <button className='flex flex-col' onClick={() => props.handleClick(props.wallet.id)}>
            <div className="flex">
                <img src={props.wallet.icon} alt='wallet-logo' width={28} height={28}/>
                <span className='text-gray-300 ml-2 text-sm grow'>{props.wallet.id}</span>
            </div>
            </button>
        </div>
  );
}

interface xAPIStatement {
  id: string;
  wallet_address: string;
  statement_id: string,
  hash: string,
  status: string,
  processed_time: string,
  error: string,
  cardano_hash: string,
}

function App() {
  const [wallets, setWallets] = useState([] as WalletInfo[]);
  const [enabledWallet, setEnabledWallet] = useState<WalletInfo>();
  const [balance, setBalance] = useState<string>();
  const [network, setNetwork] = useState<string>();
  const [address, setAddress] = useState<Address>();
  const [error, setError] = useState();
  const [message, setMessage] = useState("");
  const [xapiStatements, setXAPIStatements] = useState([] as xAPIStatement[]);
  const [xapiPendingStatements, setXAPIPendingStatements] = useState([] as xAPIStatement[]);

  useEffect(() => {
    setWallets(getAvailableWallets());
  },[]);

  const connectWallet = useCallback( async (walletId: WALLET_IDS) => {
    try {
      // clears the error state
      setError(undefined);

      // Enables the wallet
      setEnabledWallet(await enable(walletId));

      // Gets the enabled wallet balance
      setBalance(await getBalance());

      // Gets the enabled wallet network
      setNetwork(await getNetwork());

      setAddress(await getChangeAddress());

    }catch(error: any) {
      setError(error.message || 'unknown errorr');
    }
  }, []);

  const getMoodleLink = async function (addr:any) {

    const raw = await getChangeAddress();
    console.log(Buffer.from(raw, "hex"))
    const changeAddress = Address.from_bytes(Buffer.from(raw, "hex")).to_bech32()
    console.log(changeAddress)

    var accaddrHash = md5(changeAddress)

    var MOODLEURL = process.env.REACT_APP_MOODLEURL
    var MOODLEAPITOKEN = process.env.REACT_APP_MOODLEAPITOKEN
    var url = MOODLEURL + '/webservice/rest/server.php?wstoken=' + MOODLEAPITOKEN + '&wsfunction=auth_userkey_request_login_url&moodlewsrestformat=json';

    const postdata = new FormData();
    postdata.append('user[username]', accaddrHash.toLowerCase());
    postdata.append('user[idnumber]', changeAddress.toLowerCase());

    fetch(url, {
      method: 'POST',
      body: postdata
    })
    .then((response) => response.json())
    .then((data) => {
      console.log(data)
      if(data['errorcode'])
        setMessage(data['message'])
      else {
        setMessage(data['loginurl']) // This is the loginurl which can be used to access the Moodle without entring any further details.
      }
    });
  };

  const postToCardano = async function(hashes:any) {
    var hashIds = [];

    // instantiate the tx builder with the Cardano protocol parameters - these may change later on
    const rawAddress = await getChangeAddress()
    const walletAddress = Address.from_bytes(Buffer.from(rawAddress, "hex"))
    
    var params = { // You may need to adjust these parameters.
        linearFee: {
            minFeeA: "44",
            minFeeB: "255381",
        },
        minUtxo: "34482",
        poolDeposit: "500000000",
        keyDeposit: "2000000",
        maxValSize: 5000,
        maxTxSize: 16384,
        priceMem: 0.0577,
        priceStep: 0.0000721,
        coinsPerUtxoWord: "34482",
        lovelaceToSend: 1000000,
        addressBech32SendADA: process.env.REACT_APP_TX_RECEIVER?.toString(),
        changeAddress: walletAddress
    }
    if(params.addressBech32SendADA == undefined) {
      alert("Reciever Address is not set.")
      return;
    }
      
    const txBuilder = CardanoWasm.TransactionBuilder.new(
      TransactionBuilderConfigBuilder.new()
          .fee_algo(
              LinearFee.new(
                  BigNum.from_str(params.linearFee.minFeeA), 
                  BigNum.from_str(params.linearFee.minFeeB)
              )
          )
          .pool_deposit(BigNum.from_str(params.poolDeposit))
          .key_deposit(BigNum.from_str(params.keyDeposit))
          .coins_per_utxo_word(BigNum.from_str(params.coinsPerUtxoWord))
          .max_value_size(params.maxValSize)
          .max_tx_size(params.maxTxSize)
          .prefer_pure_change(true)
          .build()
    );

    const shelleyOutputAddress = Address.from_bech32(params.addressBech32SendADA) // Reciever Address
    const shelleyChangeAddress = params.changeAddress // Wallet Address
    

    let txOutputs = CardanoWasm.TransactionUnspentOutputs.new()
    let utxos = await getUtxos();
    for (const utxo of utxos) {
        const tmputxo = CardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(utxo, "hex"));
        txOutputs.add(tmputxo)
    }
    
    const txUnspentOutputs = txOutputs;
    txBuilder.add_inputs_from(txUnspentOutputs, 1)

    txBuilder.add_output(
        CardanoWasm.TransactionOutput.new(
            shelleyOutputAddress,
            CardanoWasm.Value.new(BigNum.from_str(params.lovelaceToSend.toString()))
        ),
    );

    txBuilder.add_change_if_needed(shelleyChangeAddress)
    
    for (let k in hashes) { // Addint hashes to metadata.
      const hashData = hashes[k];
      txBuilder.add_metadatum(CardanoWasm.BigNum.from_str(hashData.id.toString()), CardanoWasm.TransactionMetadatum.new_text(hashData.hash))
      hashIds.push(hashData.id)
    }

    const txBody = txBuilder.build();

    const transactionWitnessSet = TransactionWitnessSet.new();

    const tx = Transaction.new(
        txBody,
        TransactionWitnessSet.from_bytes(transactionWitnessSet.to_bytes()),
        txBuilder.get_auxiliary_data()
    )

    let txVkeyWitnesses = await signTx(
        Buffer.from(
            tx.to_bytes(), "utf8"
        ).toString("hex"), 
        false
    );

    txVkeyWitnesses = TransactionWitnessSet.from_bytes(
        Buffer.from(txVkeyWitnesses, "hex")
    );

    transactionWitnessSet.set_vkeys(txVkeyWitnesses.vkeys());

    const signedTx = Transaction.new(
        tx.body(),
        transactionWitnessSet,
        tx.auxiliary_data()
    );

    const submittedTxHash = await submitTx(
        Buffer.from(
            signedTx.to_bytes(), "utf8"
        ).toString("hex")
    );
    console.log(submittedTxHash)

    // Posting status to Trax LRS
    var TRAXLRSURL = process.env.REACT_APP_TRAXLRSURL
    const postdata = new FormData();
    postdata.append('hash_ids', JSON.stringify(hashIds));
    postdata.append('cardano_hash', submittedTxHash);

    return fetch(TRAXLRSURL + 'api/save-status', {
      method: 'POST',
      body: postdata
    })
    .then((response) => response.json())
    .then((data) => {
      console.log(data)
      setMessage(data['message'] + " => " + submittedTxHash)
      setXAPIPendingStatements([])
      fetchAllStatements()
    });
  }

  const fetchPendingStatements = async function () {
    const raw = await getChangeAddress();
    const walletAddress = Address.from_bytes(Buffer.from(raw, "hex")).to_bech32()
    var TRAXLRSURL = process.env.REACT_APP_TRAXLRSURL
    var TRAXLRSDATALIMIT = process.env.REACT_APP_TRAXLRS_DATA_LIMIT

    fetch(TRAXLRSURL + 'api/get-pending-data?walletaddress=' + walletAddress + '&limit=' + TRAXLRSDATALIMIT, {method: 'GET'})
    .then((response) => response.json())
    .then((data) => {
      console.log(data)
      if(data['errorcode']){
        setMessage(data['message'])
      }
      else {
        setXAPIPendingStatements(Object.values(data['hashes']))
      }
    });
  };

  const fetchAllStatements = async function () {
    const raw = await getChangeAddress();
    const walletAddress = Address.from_bytes(Buffer.from(raw, "hex")).to_bech32()
    var TRAXLRSURL = process.env.REACT_APP_TRAXLRSURL
    var TRAXLRSDATALIMIT = 999999

    fetch(TRAXLRSURL + 'api/get-all-data?walletaddress=' + walletAddress + '&limit=' + TRAXLRSDATALIMIT, {method: 'GET'})
    .then((response) => response.json())
    .then((data) => {
      console.log(data)
      if(data['errorcode']){
        setMessage(data['message'])
      }
      else {
        setXAPIStatements(Object.values(data['hashes']))
      }
    });
  };

  return (
    <div className="w-screen h-screen bg-white overflow-auto">
        <div className="container max-w-6xl p-16  h-full w-full">
            <header className="mb-3 py-6 w-full flex flex-col justify-between">                
                <h3 className="text-3xl text-orange-500 font-extrabold mt-1 ">PoLiL</h3>
                <h3 className="text-1xl text-orange-500 font-extrabold mt-1 ">Proof of Lifelong Learning</h3>
                <div className="mt-8 rounded-lg border bg-orange-600 bg-opacity-10 p-1 text-[#194866] mb-4">
                    <h1 className="font-bold">All your learning actvities in a Cardano wallet</h1>
                    
                </div>
            </header>

            {/* Available wallets */}
            {wallets.length ? <>
              <div className="grid gap-8 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                { wallets.map((wallet: WalletInfo) => <WalletCard key={wallet.id} wallet={wallet} handleClick={connectWallet}/>)}
              </div>
            </> : <h3 className="text-3xl text-[#194866] font-extrabold mt-4">No Wallets were found</h3>}

            {/* Connected Wallet information */}
            <div className='mt-8'>
              { enabledWallet ? 
              <>
                <h3 className="text-l text-[#194866] font-extrabold mt-4">{`Connected to ${enabledWallet.name}`} {network ? `- ${network}` : null}</h3>
                <h3 className="text-sm text-[#194866] mt-4">{balance ? `Wallet Balance: ${balance}` : null}</h3>  
                { address ?
                <><div className="flex py-2">
                    {message ? <a className="text-[#194866] underline mt-3 text-sm" href={message} target="_blank" rel="noreferrer">{message}</a> : null}
                  </div>
                  <div className="flex ">
                    <button className="mt-2 rounded-lg border border-blue-500 bg-blue-600 bg-opacity-10 p-4 text-[#194866] mb-4" onClick={()=>{getMoodleLink(address)}}>Access to Moodle</button>
                    <button className="mt-2 rounded-lg border border-blue-500 bg-blue-600 bg-opacity-10 p-4 text-[#194866] mb-4 ml-4" onClick={()=>{fetchAllStatements()}}>Learning statements DONE</button>
                    <button className="mt-2 rounded-lg border border-blue-500 bg-blue-600 bg-opacity-10 p-4 text-[#194866] mb-4 ml-4" onClick={()=>{fetchPendingStatements()}}>Statements to Confirm & Submit </button>                    
                  </div>
                  
                  {xapiPendingStatements.length > 0 ?
                    <>
                    <div className="mt-4 rounded-lg border border-blue-500 p-4 mb-4">
                      <div>
                        <p><strong>Pending learning statements</strong> <small>(You can decide what is relevant to store by clicking the transaction hash)</small></p>
                        <ol>
                          {xapiPendingStatements.map((xapio) => <li key={`${xapio.id}`} ><span>{xapio.id} </span><a target="_blank" rel="noreferrer" href={`https://gateway.pinata.cloud/ipfs/${xapio.hash}`}>{xapio.hash}</a></li>)}
                        </ol>
                        <button className="mt-2 rounded-lg border border-blue-500 bg-blue-600 bg-opacity-10 p-4 text-[#194866] mb-4" onClick={()=>{postToCardano(xapiPendingStatements)}}>Submit</button>
                      </div>
                    </div></>: <></>
                  }

                  {xapiStatements.length > 0 ?
                    <>
                    <div className="mt-4 rounded-lg border border-blue-500 p-4 mb-4">
                      <div>
                        <p><small>Click on any learning transaction hash to view the full learning statement on IPFS.</small></p>
                        <p><small>Scan the Cardano hash, on the right network, to verify the transaction.</small></p>
                        <table>
                          <tr>
                            <th>Id</th>
                            <th>Learning transaction Hash</th>
                            <th>Cardano transaction Hash</th>
                          </tr>
                          {xapiStatements.map((xapio) =>
                            <tr key={`${xapio.id}`}>
                              <th>{xapio.id}</th>
                              <th><a target="_blank" rel="noreferrer" href={`https://gateway.pinata.cloud/ipfs/${xapio.hash}`}>{xapio.hash}</a></th>
                              <th>{xapio.cardano_hash != null ? xapio.cardano_hash : "Waiting your submission" }</th>
                            </tr>
                            )}
                        </table>
                      </div>
                    </div></>: <></>
                  }
                  
                  </> : <></>
                }
              </> : 
              <><div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-l text-gray-600 font-extrabold mt-4">No wallet is connected yet</h3>
                  </div>
                </div></>}

            </div>
            
            {/* Displays any error message */}
            { error? <>
              <div className="mt-4 rounded-lg border border-red-500 bg-red-600 bg-opacity-10 p-4 text-gray-900">
                  <h1 className="font-bold">Error</h1>
                  <h3 className="text-sm text-red-500 mt-2">{`There was an error connecting to the selected wallet: ${error}`}</h3>
            </div></> : null }
            
        </div>
    </div>
  );  
}

export default App;
