pragma solidity ^0.7.0;


contract C {

  uint256[] a;

  function test(uint256 i) public
  {
    a.push(0);
    a[i];
  }

}
