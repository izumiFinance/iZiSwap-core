# iZiSwap-core

<div align="center">
  <a href="https://izumi.finance"> 
    <img width="900px" height="auto" 
    src="image/logo.png">
  </a>
</div>


Core contracts for iZiSwap, a next-generation DEX to maximize capital efficiency by supporting concentrated liquidity and realizing Limit Order in a decentralized way.
[iZiSwap Periphery](https://github.com/izumiFinance/iZiSwap-periphery)  contracts are suggested entrances to interact with the core contracts.  

## Overview


<div align="center">
  <a href="https://izumi.finance"> 
    <img width="700px" height="auto" 
    src="image/overview.png">
  </a>
</div>

iZiSwap core includes the core logic implementation for swap, liquidity management, and limit orders. Due to the size limitations of individual contracts on most EVM-compatible blockchains, we have modularized the core logic into separate modules. In the main contract, iZiSwapPool, we utilize the delegateCall() method to invoke these modules.


More details can be found in the [iZiSwap whitepaper](https://github.com/izumiFinance/izumi-swap-core/blob/main/whitepaper/iZiSwap:%20Building_Decentralized_Exchange_with_Discretized_Concentrated_Liquidity_and_Limit_Order.pdf) and the [Developer Doc](https://developer.izumi.finance).



## Licensing

The primary license for iZiSwap Core is the Business Source License 1.1 (BUSL-1.1), see [LICENSE](https://github.com/izumiFinance/iZiSwap-core/blob/main/LICENSE). 


## Use source code as npm package

```
$ npm install iziswap_core
```

An example to usage this package

```
import 'iziswap_core/contracts/interfaces/IiZiSwapPool.sol';

contract Foo {
  IiZiSwapPool pool;

  function bar() {
      // pool.addLimOrderWithY(...)
      // pool.addLimOrderWithX(...)
  }
}
```