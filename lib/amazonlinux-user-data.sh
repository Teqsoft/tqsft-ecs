#!/bin/sh
echo ECS_CLUSTER=Ec2Cluster >> /etc/ecs/ecs.config

dnf install wireguard-tools