import React from "react";
import { useParams } from "react-router-dom";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";

export function AddressPage() {
  const { chainId, address } = useParams();

  return (
    <Card>
      <CardHeader>
        <CardTitle>地址详情</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Chain ID: {chainId}</p>
        <p>Address: {address}</p>
        <p>此页面正在开发中...</p>
      </CardContent>
    </Card>
  );
}
